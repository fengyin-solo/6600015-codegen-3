defmodule Scheduler.TaskExecutor do
  use GenServer

  @check_interval 2000

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  @impl true
  def init(_) do
    Process.send_after(self(), :execute_tasks, @check_interval)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:execute_tasks, state) do
    tasks = Scheduler.TaskManager.list_tasks()

    pending_tasks = Enum.filter(tasks, &(&1.status == :pending))
    running_tasks = Enum.filter(tasks, &(&1.status == :running))

    Enum.each(pending_tasks, fn task ->
      if :rand.uniform() < 0.3 do
        GenServer.cast(Scheduler.TaskManager, {:start_task, task.id})
      end
    end)

    Enum.each(running_tasks, fn task ->
      if :rand.uniform() < 0.4 do
        status = if :rand.uniform() < 0.8, do: :success, else: :failed
        GenServer.cast(Scheduler.TaskManager, {:complete_task, task.id, status})
      end
    end)

    Process.send_after(self(), :execute_tasks, @check_interval)
    {:noreply, state}
  end
end
