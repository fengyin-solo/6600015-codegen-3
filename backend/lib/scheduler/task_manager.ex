defmodule Scheduler.TaskManager do
  use GenServer

  defmodule Task do
    defstruct [
      :id, :name, :status, :node, :created_at, :started_at, :completed_at,
      :retries, :max_retries, :logs, :dependencies, :dependents
    ]
  end

  # Client API
  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def list_tasks, do: GenServer.call(__MODULE__, :list_tasks)

  def add_task(name, dependencies \\ []) do
    GenServer.call(__MODULE__, {:add_task, name, dependencies})
  end

  def retry_task(id), do: GenServer.call(__MODULE__, {:retry_task, id})

  def cancel_task(id), do: GenServer.call(__MODULE__, {:cancel_task, id})

  def get_stats, do: GenServer.call(__MODULE__, :get_stats)

  def set_dependencies(task_id, dependency_ids) do
    GenServer.call(__MODULE__, {:set_dependencies, task_id, dependency_ids})
  end

  def get_dependencies(task_id) do
    GenServer.call(__MODULE__, {:get_dependencies, task_id})
  end

  def remove_dependency(task_id, dependency_id) do
    GenServer.call(__MODULE__, {:remove_dependency, task_id, dependency_id})
  end

  def get_task(id) do
    GenServer.call(__MODULE__, {:get_task, id})
  end

  # Server callbacks
  @impl true
  def init(_) do
    tasks = for i <- 1..8 do
      name = Enum.at(~w[data_sync email_batch report_gen cache_warm log_rotate db_backup index_rebuild health_check], rem(i - 1, 8))
      status = Enum.at(~w[pending running success failed]a, :rand.uniform(4) - 1)
      %Task{
        id: "task-#{1000 + i}",
        name: name,
        status: status,
        node: "worker-#{:rand.uniform(4)}",
        created_at: DateTime.utc_now(),
        started_at: if(status != :pending, do: DateTime.utc_now()),
        completed_at: if(status in [:success, :failed], do: DateTime.utc_now()),
        retries: 0,
        max_retries: 3,
        logs: ["[INFO] Task #{name} created"],
        dependencies: [],
        dependents: []
      }
    end
    {:ok, %{tasks: tasks, counter: 1009}}
  end

  @impl true
  def handle_call(:list_tasks, _from, state) do
    {:reply, state.tasks, state}
  end

  @impl true
  def handle_call({:get_task, id}, _from, state) do
    task = Enum.find(state.tasks, &(&1.id == id))
    {:reply, task, state}
  end

  @impl true
  def handle_call({:add_task, name, dependencies}, _from, state) do
    counter = state.counter + 1
    task_id = "task-#{counter}"

    valid_deps = Enum.filter(dependencies, fn dep_id ->
      Enum.any?(state.tasks, &(&1.id == dep_id))
    end)

    initial_status = if length(valid_deps) > 0 do
      :waiting
    else
      :pending
    end

    task = %Task{
      id: task_id,
      name: name,
      status: initial_status,
      node: "worker-#{:rand.uniform(4)}",
      created_at: DateTime.utc_now(),
      retries: 0,
      max_retries: 3,
      logs: if length(valid_deps) > 0 do
        ["[INFO] Task #{name} created, waiting for dependencies: #{inspect(valid_deps)}"]
      else
        ["[INFO] Task #{name} queued"]
      end,
      dependencies: valid_deps,
      dependents: []
    }

    tasks = Enum.map(state.tasks, fn t ->
      if t.id in valid_deps do
        %{t | dependents: [task_id | t.dependents]}
      else
        t
      end
    end)

    {:reply, task, %{state | tasks: [task | tasks], counter: counter}}
  end

  @impl true
  def handle_call({:retry_task, id}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id} = t ->
        new_status = if length(t.dependencies) > 0 and not dependencies_met?(t, state.tasks) do
          :waiting
        else
          :pending
        end
        %{t | status: new_status, retries: t.retries + 1, logs: t.logs ++ ["[INFO] Retrying..."]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call({:cancel_task, id}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id} = t ->
        %{t | status: :failed, logs: t.logs ++ ["[WARN] Cancelled"]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call({:set_dependencies, task_id, dependency_ids}, _from, state) do
    task = Enum.find(state.tasks, &(&1.id == task_id))
    if is_nil(task) do
      {:reply, {:error, "Task not found"}, state}
    else
      valid_deps = Enum.filter(dependency_ids, fn dep_id ->
        dep_id != task_id and Enum.any?(state.tasks, &(&1.id == dep_id))
      end)

      tasks = Enum.map(state.tasks, fn t ->
        cond do
          t.id == task_id ->
            old_deps = t.dependencies
            new_status = if length(valid_deps) > 0 and not dependencies_met?(%{t | dependencies: valid_deps}, state.tasks) do
              :waiting
            else
              :pending
            end
            %{t |
              dependencies: valid_deps,
              status: if(t.status == :pending or t.status == :waiting, do: new_status, else: t.status),
              logs: t.logs ++ ["[INFO] Dependencies updated: #{inspect(valid_deps)}"]
            }
          t.id in task.dependencies and not (t.id in valid_deps) ->
            %{t | dependents: List.delete(t.dependents, task_id)}
          t.id in valid_deps and not (t.id in task.dependencies) ->
            %{t | dependents: [task_id | t.dependents]}
          true -> t
        end
      end)

      updated_task = Enum.find(tasks, &(&1.id == task_id))
      {:reply, {:ok, updated_task}, %{state | tasks: tasks}}
    end
  end

  @impl true
  def handle_call({:get_dependencies, task_id}, _from, state) do
    task = Enum.find(state.tasks, &(&1.id == task_id))
    if is_nil(task) do
      {:reply, {:error, "Task not found"}, state}
    else
      deps = Enum.filter(state.tasks, &(&1.id in task.dependencies))
      {:reply, {:ok, deps}, state}
    end
  end

  @impl true
  def handle_call({:remove_dependency, task_id, dependency_id}, _from, state) do
    task = Enum.find(state.tasks, &(&1.id == task_id))
    if is_nil(task) do
      {:reply, {:error, "Task not found"}, state}
    else
      new_deps = List.delete(task.dependencies, dependency_id)
      tasks = Enum.map(state.tasks, fn t ->
        cond do
          t.id == task_id ->
            new_status = if length(new_deps) > 0 and not dependencies_met?(%{t | dependencies: new_deps}, state.tasks) do
              :waiting
            else
              :pending
            end
            %{t |
              dependencies: new_deps,
              status: if(t.status == :waiting, do: new_status, else: t.status),
              logs: t.logs ++ ["[INFO] Dependency removed: #{dependency_id}"]
            }
          t.id == dependency_id ->
            %{t | dependents: List.delete(t.dependents, task_id)}
          true -> t
        end
      end)

      updated_task = Enum.find(tasks, &(&1.id == task_id))
      {:reply, {:ok, updated_task}, %{state | tasks: tasks}}
    end
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    stats = %{
      total: length(state.tasks),
      running: Enum.count(state.tasks, & &1.status == :running),
      success: Enum.count(state.tasks, & &1.status == :success),
      failed: Enum.count(state.tasks, & &1.status == :failed),
      pending: Enum.count(state.tasks, & &1.status == :pending),
      waiting: Enum.count(state.tasks, & &1.status == :waiting)
    }
    {:reply, stats, state}
  end

  @impl true
  def handle_cast({:start_task, id}, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id, status: :pending} = t ->
        %{t |
          status: :running,
          started_at: DateTime.utc_now(),
          logs: t.logs ++ ["[INFO] Task started on #{t.node}"]
        }
      t -> t
    end)
    {:noreply, %{state | tasks: tasks}}
  end

  @impl true
  def handle_cast({:complete_task, id, status}, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id} = t ->
        %{t |
          status: status,
          completed_at: DateTime.utc_now(),
          logs: t.logs ++ ["[INFO] Task completed with status: #{status}"]
        }
      t -> t
    end)

    tasks = if status == :success do
      trigger_dependents(id, tasks)
    else
      tasks
    end

    {:noreply, %{state | tasks: tasks}}
  end

  defp dependencies_met?(task, all_tasks) do
    Enum.all?(task.dependencies, fn dep_id ->
      dep = Enum.find(all_tasks, &(&1.id == dep_id))
      not is_nil(dep) and dep.status == :success
    end)
  end

  defp trigger_dependents(task_id, all_tasks) do
    task = Enum.find(all_tasks, &(&1.id == task_id))
    if is_nil(task) do
      all_tasks
    else
      Enum.map(all_tasks, fn t ->
        if t.id in task.dependents and t.status == :waiting do
          if dependencies_met?(t, all_tasks) do
            %{t |
              status: :pending,
              logs: t.logs ++ ["[INFO] All dependencies met, task ready to run"]
            }
          else
            t
          end
        else
          t
        end
      end)
    end
  end
end
