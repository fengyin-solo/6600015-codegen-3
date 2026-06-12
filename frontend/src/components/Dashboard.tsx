import { useState, useEffect } from 'react'
import { Layout, Tabs, Statistic, Row, Col, Card, Tag, Button, Input, Table, Drawer, Descriptions, Space, Progress, Modal, Select, List, Badge, Tooltip, Empty } from 'antd'
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { useTaskStore } from '../store/tasks'
import type { Task, TaskStatus } from '../types'

const { Header, Content } = Layout
const { Option } = Select

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  retry: 'warning',
  waiting: 'purple',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待执行',
  running: '运行中',
  success: '成功',
  failed: '失败',
  retry: '重试中',
  waiting: '等待依赖',
}

export default function Dashboard() {
  const store = useTaskStore()
  const [newTaskName, setNewTaskName] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [depModalOpen, setDepModalOpen] = useState(false)
  const [selectedTaskForDeps, setSelectedTaskForDeps] = useState<Task | null>(null)
  const [newTaskDeps, setNewTaskDeps] = useState<string[]>([])
  const [showAddWithDeps, setShowAddWithDeps] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      store.simulateTick()
      store.addMetric()
    }, 2000)
    return () => clearInterval(interval)
  }, [store])

  const getDependencyStatus = (task: Task) => {
    if (task.dependencies.length === 0) return null
    const deps = store.tasks.filter(t => task.dependencies.includes(t.id))
    const completed = deps.filter(d => d.status === 'success').length
    const failed = deps.filter(d => d.status === 'failed').length
    return { completed, failed, total: deps.length }
  }

  const taskColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 110,
      render: (s: TaskStatus, r: Task) => {
        const depStatus = getDependencyStatus(r)
        return (
          <Space direction="vertical" size={0}>
            <Tag color={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</Tag>
            {depStatus && (
              <span style={{ fontSize: 11, color: '#888' }}>
                依赖: {depStatus.completed}/{depStatus.total}
                {depStatus.failed > 0 && <span style={{ color: '#ff4d4f' }}> ({depStatus.failed}失败)</span>}
              </span>
            )}
          </Space>
        )
      }
    },
    { title: '节点', dataIndex: 'node', key: 'node', width: 110 },
    {
      title: '前置依赖', key: 'deps', width: 150,
      render: (_: any, r: Task) => {
        if (r.dependencies.length === 0) return <span style={{ color: '#bbb' }}>无</span>
        return (
          <Space wrap size={4}>
            {r.dependencies.slice(0, 3).map(depId => {
              const dep = store.tasks.find(t => t.id === depId)
              return dep ? (
                <Tooltip key={depId} title={`${dep.name}: ${STATUS_LABELS[dep.status]}`}>
                  <Badge status={dep.status === 'success' ? 'success' : dep.status === 'failed' ? 'error' : 'processing'} />
                  <span style={{ fontSize: 12 }}>{dep.name}</span>
                </Tooltip>
              ) : null
            })}
            {r.dependencies.length > 3 && <span style={{ fontSize: 12, color: '#888' }}>+{r.dependencies.length - 3}</span>}
          </Space>
        )
      }
    },
    {
      title: '后置任务', key: 'dependents', width: 150,
      render: (_: any, r: Task) => {
        if (r.dependents.length === 0) return <span style={{ color: '#bbb' }}>无</span>
        return (
          <Space wrap size={4}>
            {r.dependents.slice(0, 3).map(depId => {
              const dep = store.tasks.find(t => t.id === depId)
              return dep ? (
                <Tooltip key={depId} title={`${dep.name}: ${STATUS_LABELS[dep.status]}`}>
                  <span style={{ fontSize: 12, background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>{dep.name}</span>
                </Tooltip>
              ) : null
            })}
            {r.dependents.length > 3 && <span style={{ fontSize: 12, color: '#888' }}>+{r.dependents.length - 3}</span>}
          </Space>
        )
      }
    },
    { title: '重试', key: 'retries', width: 70, render: (_: any, r: Task) => `${r.retries}/${r.maxRetries}` },
    { title: '耗时', key: 'duration', width: 80, render: (_: any, r: Task) => r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '-' },
    {
      title: '操作', key: 'actions', width: 220,
      render: (_: any, r: Task) => (
        <Space size={4}>
          {r.status === 'failed' && <Button size="small" type="primary" onClick={() => store.retryTask(r.id)}>重试</Button>}
          {r.status === 'running' && <Button size="small" danger onClick={() => store.cancelTask(r.id)}>取消</Button>}
          {r.status === 'success' && (
            <Button size="small" onClick={() => store.completeTask(r.id, 'success')} disabled>
              已完成
            </Button>
          )}
          <Button size="small" onClick={() => { store.selectTask(r); setDrawerOpen(true) }}>详情</Button>
          <Button size="small" type="link" onClick={() => { setSelectedTaskForDeps(r); setDepModalOpen(true) }}>
            设置依赖
          </Button>
        </Space>
      )
    },
  ]

  const successCount = store.tasks.filter(t => t.status === 'success').length
  const failedCount = store.tasks.filter(t => t.status === 'failed').length
  const runningCount = store.tasks.filter(t => t.status === 'running').length
  const waitingCount = store.tasks.filter(t => t.status === 'waiting').length
  const pendingCount = store.tasks.filter(t => t.status === 'pending').length

  const availableTasksForDeps = store.tasks.filter(t =>
    selectedTaskForDeps && t.id !== selectedTaskForDeps.id
  )

  const renderDependencyGraph = () => {
    const tasks = store.tasks
    if (tasks.length === 0) return <Empty description="暂无任务" />

    return (
      <div style={{ overflowX: 'auto', padding: 20, minHeight: 400 }}>
        <svg width="100%" height="600" style={{ minWidth: tasks.length * 180 }}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#999" />
            </marker>
          </defs>
          {tasks.map((task, i) => {
            const x = 100 + (i % 6) * 200
            const y = 80 + Math.floor(i / 6) * 180

            task.dependencies.forEach(depId => {
              const depIdx = tasks.findIndex(t => t.id === depId)
              if (depIdx >= 0) {
                const depX = 180 + (depIdx % 6) * 200
                const depY = 120 + Math.floor(depIdx / 6) * 180
                const color = tasks[depIdx].status === 'success' ? '#52c41a' : tasks[depIdx].status === 'failed' ? '#ff4d4f' : '#999'
                return (
                  <line
                    key={`${depId}-${task.id}`}
                    x1={depX} y1={depY} x2={x + 60} y2={y + 40}
                    stroke={color} strokeWidth="2"
                    markerEnd="url(#arrowhead)"
                    strokeDasharray={tasks[depIdx].status === 'success' ? '' : '5,5'}
                  />
                )
              }
              return null
            })

            const statusColor = {
              pending: '#d9d9d9',
              running: '#1890ff',
              success: '#52c41a',
              failed: '#ff4d4f',
              waiting: '#722ed1',
              retry: '#faad14',
            }[task.status]

            return (
              <g key={task.id}>
                <rect
                  x={x} y={y} width={140} height={80}
                  rx={8} ry={8}
                  fill="white"
                  stroke={statusColor}
                  strokeWidth="2"
                />
                <text x={x + 70} y={y + 30} textAnchor="middle" fontSize="13" fontWeight="bold" fill="#333">
                  {task.name}
                </text>
                <text x={x + 70} y={y + 50} textAnchor="middle" fontSize="11" fill="#999">
                  {task.id}
                </text>
                <text x={x + 70} y={y + 68} textAnchor="middle" fontSize="11" fill={statusColor}>
                  {STATUS_LABELS[task.status]}
                </text>
                {task.dependencies.length > 0 && (
                  <circle cx={x + 130} cy={y + 10} r={8} fill="#722ed1" />
                )}
                {task.dependents.length > 0 && (
                  <text x={x + 130} y={y + 14} textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">
                    {task.dependents.length}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ color: 'white', margin: 0, fontSize: 18 }}>🔧 分布式任务调度与监控平台</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!showAddWithDeps ? (
            <>
              <Input placeholder="任务名称" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} style={{ width: 160 }} />
              <Button type="primary" onClick={() => { if (newTaskName) { store.addTask(newTaskName); setNewTaskName('') } }}>
                添加任务
              </Button>
              <Button onClick={() => setShowAddWithDeps(true)}>带依赖添加</Button>
            </>
          ) : (
            <>
              <Input placeholder="任务名称" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} style={{ width: 160 }} />
              <Select
                mode="multiple"
                placeholder="选择前置任务"
                value={newTaskDeps}
                onChange={setNewTaskDeps}
                style={{ width: 300 }}
              >
                {store.tasks.map(t => (
                  <Option key={t.id} value={t.id}>{t.name} ({t.id})</Option>
                ))}
              </Select>
              <Button type="primary" onClick={() => {
                if (newTaskName) {
                  store.addTask(newTaskName, newTaskDeps)
                  setNewTaskName('')
                  setNewTaskDeps([])
                  setShowAddWithDeps(false)
                }
              }}>
                创建
              </Button>
              <Button onClick={() => { setShowAddWithDeps(false); setNewTaskDeps([]) }}>取消</Button>
            </>
          )}
        </div>
      </Header>
      <Content style={{ padding: 16 }}>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={4}><Card><Statistic title="总任务" value={store.tasks.length} /></Card></Col>
          <Col span={4}><Card><Statistic title="运行中" value={runningCount} valueStyle={{ color: '#1890ff' }} /></Card></Col>
          <Col span={4}><Card><Statistic title="等待依赖" value={waitingCount} valueStyle={{ color: '#722ed1' }} /></Card></Col>
          <Col span={4}><Card><Statistic title="待执行" value={pendingCount} valueStyle={{ color: '#faad14' }} /></Card></Col>
          <Col span={4}><Card><Statistic title="成功" value={successCount} valueStyle={{ color: '#52c41a' }} /></Card></Col>
          <Col span={4}><Card><Statistic title="失败" value={failedCount} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        </Row>

        <Tabs items={[
          { key: 'metrics', label: '监控指标', children: (
            <Row gutter={16}>
              <Col span={12}>
                <Card title="运行中任务数">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <RechartsTooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Area type="monotone" dataKey="runningTasks" stroke="#1890ff" fill="#1890ff" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={12}>
                <Card title="成功率 %">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis domain={[0, 100]} fontSize={10} />
                      <RechartsTooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Line type="monotone" dataKey="successRate" stroke="#52c41a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={24} style={{ marginTop: 16 }}>
                <Card title="平均延迟 (ms)">
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <RechartsTooltip />
                      <Area type="monotone" dataKey="avgLatency" stroke="#faad14" fill="#faad14" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>
          )},
          { key: 'tasks', label: '任务列表', children: (
            <Table dataSource={store.tasks} columns={taskColumns} rowKey="id" size="small" pagination={{ pageSize: 10 }} />
          )},
          { key: 'dependencies', label: '依赖编排视图', children: (
            <Card title="任务依赖关系图">
              <div style={{ background: '#fafafa', borderRadius: 8, marginBottom: 16 }}>
                {renderDependencyGraph()}
              </div>
              <Row gutter={16}>
                <Col span={12}>
                  <Card title="图例" size="small">
                    <Space direction="vertical">
                      <Space><Tag color="purple">等待依赖</Tag> 等待所有前置任务完成</Space>
                      <Space><Tag color="default">待执行</Tag> 依赖已满足，等待调度</Space>
                      <Space><Tag color="processing">运行中</Tag> 正在执行</Space>
                      <Space><Tag color="success">成功</Tag> 执行成功，可触发后置任务</Space>
                      <Space><Tag color="error">失败</Tag> 执行失败，后置任务将被阻塞</Space>
                    </Space>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title="依赖阻塞的任务" size="small">
                    {store.tasks.filter(t => t.status === 'waiting').length === 0 ? (
                      <Empty description="暂无阻塞任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <List
                        size="small"
                        dataSource={store.tasks.filter(t => t.status === 'waiting')}
                        renderItem={task => {
                          const deps = store.tasks.filter(t => task.dependencies.includes(t.id))
                          const unmetDeps = deps.filter(d => d.status !== 'success')
                          return (
                            <List.Item>
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <Space>
                                  <Tag color="purple">{task.name}</Tag>
                                  <span style={{ fontSize: 12, color: '#888' }}>等待 {unmetDeps.length} 个前置任务</span>
                                </Space>
                                <Space wrap size={4}>
                                  {unmetDeps.map(d => (
                                    <Tag key={d.id} color={STATUS_COLORS[d.status]} size="small">
                                      {d.name}: {STATUS_LABELS[d.status]}
                                    </Tag>
                                  ))}
                                </Space>
                              </Space>
                            </List.Item>
                          )
                        }}
                      />
                    )}
                  </Card>
                </Col>
              </Row>
            </Card>
          )},
          { key: 'nodes', label: '集群节点', children: (
            <Row gutter={16}>
              {store.nodes.map(node => (
                <Col span={8} key={node.id} style={{ marginBottom: 16 }}>
                  <Card title={<span>{node.type === 'scheduler' ? '🎯' : '⚙️'} {node.name}</span>}
                    extra={<Tag color={node.status === 'online' ? 'green' : node.status === 'overloaded' ? 'orange' : 'red'}>{node.status}</Tag>}>
                    <Progress percent={Math.round(node.cpu)} strokeColor={node.cpu > 80 ? '#ff4d4f' : '#1890ff'} format={v => `CPU ${v}%`} />
                    <Progress percent={Math.round(node.memory)} strokeColor={node.memory > 80 ? '#ff4d4f' : '#52c41a'} format={v => `MEM ${v}%`} />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                      任务数: {node.tasks} | 运行时间: {Math.floor(node.uptime / 3600)}h
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )},
        ]} />

        <Drawer title="任务详情" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={560}>
          {store.selectedTask && (
            <>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="ID">{store.selectedTask.id}</Descriptions.Item>
                <Descriptions.Item label="名称">{store.selectedTask.name}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={STATUS_COLORS[store.selectedTask.status]}>{STATUS_LABELS[store.selectedTask.status]}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="执行节点">{store.selectedTask.node}</Descriptions.Item>
                <Descriptions.Item label="重试次数">{store.selectedTask.retries}/{store.selectedTask.maxRetries}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{new Date(store.selectedTask.createdAt).toLocaleString()}</Descriptions.Item>
                {store.selectedTask.startedAt && (
                  <Descriptions.Item label="开始时间">{new Date(store.selectedTask.startedAt).toLocaleString()}</Descriptions.Item>
                )}
                {store.selectedTask.completedAt && (
                  <Descriptions.Item label="完成时间">{new Date(store.selectedTask.completedAt).toLocaleString()}</Descriptions.Item>
                )}
                <Descriptions.Item label="耗时">{store.selectedTask.duration ? `${(store.selectedTask.duration / 1000).toFixed(1)}s` : '-'}</Descriptions.Item>
                <Descriptions.Item label="前置依赖">
                  {store.selectedTask.dependencies.length === 0 ? (
                    <span style={{ color: '#999' }}>无</span>
                  ) : (
                    <Space wrap>
                      {store.selectedTask.dependencies.map(depId => {
                        const dep = store.tasks.find(t => t.id === depId)
                        return dep ? (
                          <Tag key={depId} color={STATUS_COLORS[dep.status]}>
                            {dep.name} - {STATUS_LABELS[dep.status]}
                          </Tag>
                        ) : <Tag key={depId}>已删除</Tag>
                      })}
                    </Space>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="后置任务">
                  {store.selectedTask.dependents.length === 0 ? (
                    <span style={{ color: '#999' }}>无</span>
                  ) : (
                    <Space wrap>
                      {store.selectedTask.dependents.map(depId => {
                        const dep = store.tasks.find(t => t.id === depId)
                        return dep ? (
                          <Tag key={depId} color={STATUS_COLORS[dep.status]}>
                            {dep.name} - {STATUS_LABELS[dep.status]}
                          </Tag>
                        ) : <Tag key={depId}>已删除</Tag>
                      })}
                    </Space>
                  )}
                </Descriptions.Item>
              </Descriptions>

              <h4 style={{ marginTop: 16, marginBottom: 8 }}>执行日志</h4>
              <pre style={{ background: '#1f1f1f', color: '#ccc', padding: 12, borderRadius: 8, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
                {store.selectedTask.logs.join('\n')}
              </pre>
            </>
          )}
        </Drawer>

        <Modal
          title={`设置任务依赖 - ${selectedTaskForDeps?.name || ''}`}
          open={depModalOpen}
          onCancel={() => setDepModalOpen(false)}
          onOk={() => {
            if (selectedTaskForDeps) {
              const currentDeps = store.tasks.find(t => t.id === selectedTaskForDeps.id)?.dependencies || []
              store.setDependencies(selectedTaskForDeps.id, currentDeps)
            }
            setDepModalOpen(false)
          }}
          width={600}
        >
          {selectedTaskForDeps && (
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              <div>
                <label style={{ fontWeight: 'bold', marginBottom: 8, display: 'block' }}>选择前置任务（必须全部成功完成后才能启动）</label>
                <Select
                  mode="multiple"
                  placeholder="选择一个或多个前置任务"
                  value={store.tasks.find(t => t.id === selectedTaskForDeps.id)?.dependencies || []}
                  onChange={(values) => store.setDependencies(selectedTaskForDeps.id, values)}
                  style={{ width: '100%' }}
                  size="large"
                >
                  {availableTasksForDeps.map(t => (
                    <Option key={t.id} value={t.id}>
                      <Space>
                        <Badge status={t.status === 'success' ? 'success' : t.status === 'failed' ? 'error' : 'processing'} />
                        {t.name} ({t.id}) - {STATUS_LABELS[t.status]}
                      </Space>
                    </Option>
                  ))}
                </Select>
              </div>

              <Card size="small" title="当前依赖链">
                {(() => {
                  const currentTask = store.tasks.find(t => t.id === selectedTaskForDeps.id)
                  if (!currentTask) return null
                  const deps = store.tasks.filter(t => currentTask.dependencies.includes(t.id))
                  if (deps.length === 0) {
                    return <Empty description="暂无前置依赖" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  }
                  return (
                    <List
                      size="small"
                      dataSource={deps}
                      renderItem={dep => (
                        <List.Item
                          actions={[
                            <Button
                              type="link"
                              danger
                              size="small"
                              onClick={() => store.removeDependency(selectedTaskForDeps.id, dep.id)}
                            >
                              移除
                            </Button>
                          ]}
                        >
                          <Space>
                            <Tag color={STATUS_COLORS[dep.status]}>{STATUS_LABELS[dep.status]}</Tag>
                            <span style={{ fontWeight: 500 }}>{dep.name}</span>
                            <span style={{ color: '#999', fontSize: 12 }}>{dep.id}</span>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )
                })()}
              </Card>

              <Card size="small" title="将被触发的后置任务">
                {(() => {
                  const currentTask = store.tasks.find(t => t.id === selectedTaskForDeps.id)
                  if (!currentTask) return null
                  const dependents = store.tasks.filter(t => currentTask.dependents.includes(t.id))
                  if (dependents.length === 0) {
                    return <Empty description="暂无后置任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  }
                  return (
                    <List
                      size="small"
                      dataSource={dependents}
                      renderItem={dep => (
                        <List.Item>
                          <Space>
                            <Tag color={STATUS_COLORS[dep.status]}>{STATUS_LABELS[dep.status]}</Tag>
                            <span style={{ fontWeight: 500 }}>{dep.name}</span>
                            <span style={{ color: '#999', fontSize: 12 }}>{dep.id}</span>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )
                })()}
              </Card>
            </Space>
          )}
        </Modal>
      </Content>
    </Layout>
  )
}
