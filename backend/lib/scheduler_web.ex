defmodule SchedulerWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :scheduler

  plug Plug.Static, at: "/", from: :scheduler, gzip: false
  plug Plug.Parsers, parsers: [:json], pass: [], json_decoder: Jason
  plug SchedulerWeb.Router
end

defmodule SchedulerWeb.Router do
  use Phoenix.Router
  import Phoenix.Controller

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", SchedulerWeb do
    pipe_through :api
    get "/tasks", TaskController, :index
    get "/tasks/:id", TaskController, :show
    post "/tasks", TaskController, :create
    post "/tasks/:id/retry", TaskController, :retry
    post "/tasks/:id/cancel", TaskController, :cancel
    post "/tasks/:id/complete", TaskController, :complete
    get "/tasks/:id/dependencies", TaskController, :get_dependencies
    post "/tasks/:id/dependencies", TaskController, :set_dependencies
    delete "/tasks/:id/dependencies/:dep_id", TaskController, :remove_dependency
    get "/stats", TaskController, :stats
    get "/nodes", TaskController, :nodes
  end
end

defmodule SchedulerWeb.TaskController do
  use Phoenix.Controller, formats: [:json]

  def index(conn, _params) do
    tasks = Scheduler.TaskManager.list_tasks()
    json(conn, %{tasks: Enum.map(tasks, &Map.from_struct/1)})
  end

  def show(conn, %{"id" => id}) do
    task = Scheduler.TaskManager.get_task(id)
    if is_nil(task) do
      conn |> put_status(404) |> json(%{error: "Task not found"})
    else
      json(conn, %{task: Map.from_struct(task)})
    end
  end

  def create(conn, %{"name" => name} = params) do
    dependencies = Map.get(params, "dependencies", [])
    task = Scheduler.TaskManager.add_task(name, dependencies)
    json(conn, %{task: Map.from_struct(task)})
  end

  def retry(conn, %{"id" => id}) do
    Scheduler.TaskManager.retry_task(id)
    json(conn, %{status: "ok"})
  end

  def cancel(conn, %{"id" => id}) do
    Scheduler.TaskManager.cancel_task(id)
    json(conn, %{status: "ok"})
  end

  def complete(conn, %{"id" => id, "status" => status}) do
    status_atom = String.to_atom(status)
    GenServer.cast(Scheduler.TaskManager, {:complete_task, id, status_atom})
    json(conn, %{status: "ok"})
  end

  def get_dependencies(conn, %{"id" => id}) do
    case Scheduler.TaskManager.get_dependencies(id) do
      {:ok, deps} ->
        json(conn, %{dependencies: Enum.map(deps, &Map.from_struct/1)})
      {:error, reason} ->
        conn |> put_status(404) |> json(%{error: reason})
    end
  end

  def set_dependencies(conn, %{"id" => id, "dependencies" => dependency_ids}) do
    case Scheduler.TaskManager.set_dependencies(id, dependency_ids) do
      {:ok, task} ->
        json(conn, %{task: Map.from_struct(task)})
      {:error, reason} ->
        conn |> put_status(404) |> json(%{error: reason})
    end
  end

  def remove_dependency(conn, %{"id" => id, "dep_id" => dep_id}) do
    case Scheduler.TaskManager.remove_dependency(id, dep_id) do
      {:ok, task} ->
        json(conn, %{task: Map.from_struct(task)})
      {:error, reason} ->
        conn |> put_status(404) |> json(%{error: reason})
    end
  end

  def stats(conn, _params) do
    json(conn, Scheduler.TaskManager.get_stats())
  end

  def nodes(conn, _params) do
    nodes = for i <- 1..5 do
      %{
        id: "node-#{i}",
        name: if(i == 1, do: "scheduler-main", else: "worker-#{i - 1}"),
        type: if(i == 1, do: "scheduler", else: "worker"),
        status: if(:rand.uniform() > 0.1, do: "online", else: "overloaded"),
        cpu: 20 + :rand.uniform() * 60,
        memory: 30 + :rand.uniform() * 50,
        tasks: :rand.uniform(8),
        uptime: 3600 + :rand.uniform(86400)
      }
    end
    json(conn, %{nodes: nodes})
  end
end

defmodule SchedulerWeb.ErrorJSON do
  def render(template, _assigns) do
    %{errors: %{detail: Phoenix.Controller.status_message_from_template(template)}}
  end
end
