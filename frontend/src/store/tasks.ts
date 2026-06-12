import { create } from 'zustand'
import type { Task, ClusterNode, MetricsSnapshot, TaskStatus } from '../types'

function mockNodes(): ClusterNode[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `node-${i + 1}`,
    name: i === 0 ? 'scheduler-main' : `worker-${i}`,
    type: i === 0 ? 'scheduler' as const : 'worker' as const,
    status: Math.random() > 0.1 ? 'online' as const : 'overloaded' as const,
    cpu: 20 + Math.random() * 60,
    memory: 30 + Math.random() * 50,
    tasks: Math.floor(Math.random() * 8),
    uptime: 3600 + Math.floor(Math.random() * 86400),
  }))
}

function dependenciesMet(task: Task, allTasks: Task[]): boolean {
  return task.dependencies.every(depId => {
    const dep = allTasks.find(t => t.id === depId)
    return dep && dep.status === 'success'
  })
}

function mockTasks(nodes: ClusterNode[]): Task[] {
  const names = ['data_sync', 'email_batch', 'report_gen', 'cache_warm', 'log_rotate', 'db_backup', 'index_rebuild', 'health_check', 'data_clean', 'model_train', 'result_export', 'notification']
  const baseTasks = Array.from({ length: 12 }, (_, i) => {
    const status: TaskStatus[] = ['pending', 'running', 'success', 'failed']
    const s = status[Math.floor(Math.random() * 4)]
    const node = nodes[Math.floor(Math.random() * nodes.length)]
    return {
      id: `task-${1000 + i}`,
      name: names[i % names.length],
      status: s,
      node: node.name,
      createdAt: Date.now() - Math.floor(Math.random() * 600000),
      startedAt: s !== 'pending' && s !== 'waiting' ? Date.now() - Math.floor(Math.random() * 300000) : undefined,
      completedAt: (s === 'success' || s === 'failed') ? Date.now() - Math.floor(Math.random() * 60000) : undefined,
      retries: s === 'failed' ? Math.floor(Math.random() * 3) : 0,
      maxRetries: 3,
      duration: s === 'success' ? 1000 + Math.floor(Math.random() * 30000) : undefined,
      logs: [`[INFO] Task ${names[i % names.length]} started`, `[INFO] Processing on ${node.name}`],
      dependencies: [] as string[],
      dependents: [] as string[],
    }
  })

  const deps: Record<string, string[]> = {
    'task-1002': ['task-1000', 'task-1001'],
    'task-1005': ['task-1002'],
    'task-1006': ['task-1003', 'task-1004'],
    'task-1009': ['task-1008'],
    'task-1010': ['task-1009', 'task-1006'],
  }

  const tasks = baseTasks.map(t => {
    const taskDeps = deps[t.id] || []
    const newStatus = taskDeps.length > 0 && t.status === 'pending' ? 'waiting' : t.status
    return { ...t, dependencies: taskDeps, status: newStatus as TaskStatus }
  })

  return tasks.map(t => ({
    ...t,
    dependents: tasks.filter(other => other.dependencies.includes(t.id)).map(other => other.id),
    status: t.status === 'waiting' && dependenciesMet(t, tasks) ? 'pending' as TaskStatus : t.status,
  }))
}

const initialNodes = mockNodes()

interface TaskStore {
  tasks: Task[]
  nodes: ClusterNode[]
  metrics: MetricsSnapshot[]
  selectedTask: Task | null
  addTask: (name: string, dependencies?: string[]) => void
  retryTask: (id: string) => void
  cancelTask: (id: string) => void
  selectTask: (t: Task | null) => void
  refreshNodes: () => void
  addMetric: () => void
  setDependencies: (taskId: string, dependencyIds: string[]) => void
  removeDependency: (taskId: string, dependencyId: string) => void
  completeTask: (id: string, status: 'success' | 'failed') => void
  simulateTick: () => void
}

function triggerDependents(taskId: string, tasks: Task[]): Task[] {
  const task = tasks.find(t => t.id === taskId)
  if (!task) return tasks

  return tasks.map(t => {
    if (task.dependents.includes(t.id) && t.status === 'waiting' && dependenciesMet(t, tasks)) {
      return {
        ...t,
        status: 'pending' as TaskStatus,
        logs: [...t.logs, '[INFO] All dependencies met, task ready to run'],
      }
    }
    return t
  })
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: mockTasks(initialNodes),
  nodes: initialNodes,
  metrics: Array.from({ length: 20 }, (_, i) => ({
    time: Date.now() - (20 - i) * 5000,
    totalTasks: 100 + i * 2,
    runningTasks: 3 + Math.floor(Math.random() * 5),
    successRate: 85 + Math.random() * 14,
    avgLatency: 500 + Math.random() * 2000,
    nodeCount: 5,
  })),
  selectedTask: null,

  addTask: (name, dependencies = []) => {
    const validDeps = dependencies.filter(depId => get().tasks.some(t => t.id === depId))
    const initialStatus = validDeps.length > 0 && !dependenciesMet({ ...{} as Task, dependencies: validDeps }, get().tasks)
      ? 'waiting' as TaskStatus
      : 'pending' as TaskStatus

    const task: Task = {
      id: `task-${Date.now()}`,
      name,
      status: initialStatus,
      node: get().nodes[Math.floor(Math.random() * get().nodes.length)].name,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 3,
      logs: validDeps.length > 0
        ? [`[INFO] Task ${name} created, waiting for dependencies: ${validDeps.join(', ')}`]
        : [`[INFO] Task ${name} queued`],
      dependencies: validDeps,
      dependents: [],
    }

    set({
      tasks: [task, ...get().tasks.map(t =>
        validDeps.includes(t.id)
          ? { ...t, dependents: [...t.dependents, task.id] }
          : t
      )]
    })
  },

  retryTask: (id) => set({
    tasks: get().tasks.map(t => {
      if (t.id === id) {
        const newStatus = t.dependencies.length > 0 && !dependenciesMet(t, get().tasks)
          ? 'waiting' as TaskStatus
          : 'pending' as TaskStatus
        return { ...t, status: newStatus, retries: t.retries + 1, logs: [...t.logs, '[INFO] Retrying...'] }
      }
      return t
    })
  }),

  cancelTask: (id) => set({
    tasks: get().tasks.map(t => t.id === id ? { ...t, status: 'failed' as TaskStatus, logs: [...t.logs, '[WARN] Cancelled by user'] } : t)
  }),

  selectTask: (t) => set({ selectedTask: t }),

  refreshNodes: () => set({ nodes: mockNodes() }),

  addMetric: () => {
    const m: MetricsSnapshot = {
      time: Date.now(),
      totalTasks: get().tasks.length,
      runningTasks: get().tasks.filter(t => t.status === 'running').length,
      successRate: (get().tasks.filter(t => t.status === 'success').length / Math.max(get().tasks.length, 1)) * 100,
      avgLatency: 500 + Math.random() * 2000,
      nodeCount: get().nodes.filter(n => n.status !== 'offline').length,
    }
    set({ metrics: [...get().metrics.slice(-30), m] })
  },

  setDependencies: (taskId, dependencyIds) => set(state => {
    const validDeps = dependencyIds.filter(depId => depId !== taskId && state.tasks.some(t => t.id === depId))
    const task = state.tasks.find(t => t.id === taskId)
    if (!task) return state

    let tasks = state.tasks.map(t => {
      if (t.id === taskId) {
        const newStatus = validDeps.length > 0 && !dependenciesMet({ ...t, dependencies: validDeps }, state.tasks)
          ? 'waiting' as TaskStatus
          : 'pending' as TaskStatus
        return {
          ...t,
          dependencies: validDeps,
          status: (t.status === 'pending' || t.status === 'waiting') ? newStatus : t.status,
          logs: [...t.logs, `[INFO] Dependencies updated: ${validDeps.join(', ')}`],
        }
      }
      return t
    })

    tasks = tasks.map(t => {
      if (task.dependencies.includes(t.id) && !validDeps.includes(t.id)) {
        return { ...t, dependents: t.dependents.filter(d => d !== taskId) }
      }
      if (!task.dependencies.includes(t.id) && validDeps.includes(t.id)) {
        return { ...t, dependents: [...t.dependents, taskId] }
      }
      return t
    })

    return { tasks }
  }),

  removeDependency: (taskId, dependencyId) => set(state => {
    const task = state.tasks.find(t => t.id === taskId)
    if (!task) return state

    const newDeps = task.dependencies.filter(d => d !== dependencyId)

    let tasks = state.tasks.map(t => {
      if (t.id === taskId) {
        const newStatus = newDeps.length > 0 && !dependenciesMet({ ...t, dependencies: newDeps }, state.tasks)
          ? 'waiting' as TaskStatus
          : 'pending' as TaskStatus
        return {
          ...t,
          dependencies: newDeps,
          status: t.status === 'waiting' ? newStatus : t.status,
          logs: [...t.logs, `[INFO] Dependency removed: ${dependencyId}`],
        }
      }
      if (t.id === dependencyId) {
        return { ...t, dependents: t.dependents.filter(d => d !== taskId) }
      }
      return t
    })

    return { tasks }
  }),

  completeTask: (id, status) => set(state => {
    let tasks = state.tasks.map(t => {
      if (t.id === id) {
        return {
          ...t,
          status,
          completedAt: Date.now(),
          logs: [...t.logs, `[INFO] Task completed with status: ${status}`],
        }
      }
      return t
    })

    if (status === 'success') {
      tasks = triggerDependents(id, tasks)
    }

    return { tasks }
  }),

  simulateTick: () => set(state => {
    let tasks = [...state.tasks]

    tasks.forEach(t => {
      if (t.status === 'pending' && Math.random() < 0.3) {
        const idx = tasks.findIndex(x => x.id === t.id)
        tasks[idx] = {
          ...tasks[idx],
          status: 'running' as TaskStatus,
          startedAt: Date.now(),
          logs: [...tasks[idx].logs, `[INFO] Task started on ${tasks[idx].node}`],
        }
      }
    })

    tasks.forEach(t => {
      if (t.status === 'running' && Math.random() < 0.4) {
        const idx = tasks.findIndex(x => x.id === t.id)
        const resultStatus = Math.random() < 0.8 ? 'success' : 'failed'
        tasks[idx] = {
          ...tasks[idx],
          status: resultStatus as TaskStatus,
          completedAt: Date.now(),
          duration: Date.now() - (tasks[idx].startedAt || Date.now()),
          logs: [...tasks[idx].logs, `[INFO] Task completed with status: ${resultStatus}`],
        }

        if (resultStatus === 'success') {
          tasks = triggerDependents(t.id, tasks)
        }
      }
    })

    return { tasks }
  }),
}))
