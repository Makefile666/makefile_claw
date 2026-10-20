import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { PageContainer, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import { history } from '@umijs/max';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import React, { useEffect, useState } from 'react';

import {
  createAgent,
  deleteAgent,
  listAgents,
  listModels,
  listTools,
  updateAgent,
} from './service';

import type { AgentConfig, ModelConfig, ToolConfig } from './types';

const { Title, Text, Paragraph } = Typography;

// const AgentsPage: React.FC = () => {
//   const [agents, setAgents] = useState<AgentConfig[]>([]);
//   const [models, setModels] = useState<ModelConfig[]>([]);
//   const [tools, setTools] = useState<ToolConfig[]>([]);
//   const [loading, setLoading] = useState(false);
//   const [modalOpen, setModalOpen] = useState(false);
//   const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
//   const [form] = Form.useForm();

//   const reload = async () => {
//     setLoading(true);
//     try {
//       const [a, m, t] = await Promise.all([listAgents(), listModels(), listTools()]);
//       setAgents(a);
//       setModels(m);
//       setTools(t);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     reload();
//   }, []);

//   const openCreate = () => {
//     setEditingAgent(null);
//     form.resetFields();
//     form.setFieldsValue({ tools: [], active: 1 });
//     setModalOpen(true);
//   };

//   const openEdit = (agent: AgentConfig) => {
//     setEditingAgent(agent);
//     form.setFieldsValue({
//       name: agent.name,
//       description: agent.description,
//       model: agent.model,
//       systemPrompt: agent.systemPrompt,
//       tools: agent.tools ?? [],
//       active: agent.active ?? 1,
//     });
//     setModalOpen(true);
//   };

//   const handleSubmit = async () => {
//     try {
//       const values = await form.validateFields();
//       const payload = {
//         ...values,
//         tools: values.tools ?? [],
//         active: values.active ? 1 : 0,
//       };
//       if (editingAgent) {
//         await updateAgent(editingAgent.id, payload);
//         message.success('智能体已更新');
//       } else {
//         await createAgent(payload);
//         message.success('智能体已创建');
//       }
//       setModalOpen(false);
//       reload();
//     } catch {
//       // validation error
//     }
//   };

//   const handleDelete = async (id: string) => {
//     await deleteAgent(id);
//     message.success('智能体已删除');
//     reload();
//   };

//   const handleToggleActive = async (agent: AgentConfig, checked: boolean) => {
//     await updateAgent(agent.id, { active: checked ? 1 : 0 });
//     message.success(checked ? '已启用' : '已停用');
//     reload();
//   };

//   const getModelName = (model: string) =>
//     models.find((m) => m.id === model)?.name ?? model;

//   const enabledTools = tools.filter((t) => t.enabled);

//   return (
//     <PageContainer
//       header={{
//         title: 'Agents',
//         subTitle: '创建与管理智能体',
//         extra: [
//           <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
//             创建智能体
//           </Button>,
//         ],
//       }}
//     >
//       {agents.length === 0 ? (
//         <Card>
//           <Empty
//             description="还没有智能体，点击右上角「创建智能体」开始"
//             style={{ padding: 40 }}
//           />
//         </Card>
//       ) : (
//         <Row gutter={[16, 16]}>
//           {agents.map((agent) => {
//             const isActive = agent.active === 1;
//             return (
//               <Col xs={24} sm={12} md={8} lg={6} key={agent.id}>
//                 <Card
//                   hoverable
//                   style={{ height: '100%' }}
//                   actions={[
//                     <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(agent)}>
//                       编辑
//                     </Button>,
//                     <Popconfirm title="确认删除该智能体？" onConfirm={() => handleDelete(agent.id)}>
//                       <Button type="text" danger icon={<DeleteOutlined />}>
//                         删除
//                       </Button>
//                     </Popconfirm>,
//                   ]}
//                 >
//                   <Card.Meta
//                     avatar={<RobotOutlined style={{ fontSize: 32 }} />}
//                     title={
//                       <Space>
//                         <Title level={5} style={{ margin: 0 }}>{agent.name}</Title>
//                         <Tag color={isActive ? 'green' : 'default'}>
//                           {isActive ? '启用' : '停用'}
//                         </Tag>
//                       </Space>
//                     }
//                     description={<Text type="secondary">{agent.description || '暂无描述'}</Text>}
//                   />
//                   <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 8 }}>
//                     模型：<Tag color="blue">{getModelName(agent.model)}</Tag>
//                   </Paragraph>
//                   <div style={{ marginBottom: 8 }}>
//                     <Text type="secondary">工具：</Text>
//                     {(agent.tools ?? []).length === 0 ? (
//                       <Text type="secondary">未配置</Text>
//                     ) : (
//                       <Space size={[4, 4]} wrap>
//                         {agent.tools.map((toolId) => {
//                           const t = tools.find((x) => x.id === toolId);
//                           return (
//                             <Tag key={toolId} color="geekblue">
//                               {t?.name ?? toolId}
//                             </Tag>
//                           );
//                         })}
//                       </Space>
//                     )}
//                   </div>
//                   <div>
//                     <Space>
//                       <Text type="secondary">启用状态</Text>
//                       <Switch
//                         checked={isActive}
//                         onChange={(checked) => handleToggleActive(agent, checked)}
//                       />
//                     </Space>
//                   </div>
//                 </Card>
//               </Col>
//             );
//           })}
//         </Row>
//       )}

//       <Modal
//         title={editingAgent ? '编辑智能体' : '创建智能体'}
//         open={modalOpen}
//         onOk={handleSubmit}
//         onCancel={() => setModalOpen(false)}
//         width={640}
//         destroyOnClose
//       >
//         <Form form={form} layout="vertical" preserve={false}>
//           <ProFormText name="name" label="名称" placeholder="例如：代码助手" rules={[{ required: true, message: '请输入名称' }]} />
//           <ProFormTextArea name="description" label="描述" placeholder="智能体的简要说明" />
//           <Form.Item
//             name="model"
//             label="模型"
//             rules={[{ required: true, message: '请选择模型' }]}
//             tooltip="请先在「Models」页面添加模型配置"
//           >
//             <Select
//               placeholder={models.length > 0 ? '请选择模型' : '请先前往 Models 页面添加模型'}
//               options={models.map((m) => ({ label: m.name, value: m.id }))}
//               notFoundContent={
//                 <div style={{ padding: 12, textAlign: 'center' }}>
//                   <Empty
//                     image={Empty.PRESENTED_IMAGE_SIMPLE}
//                     description={
//                       <span>
//                         暂无可用模型
//                         <br />
//                         请先前往「Models」页面添加
//                       </span>
//                     }
//                   />
//                   <Button
//                     type="primary"
//                     size="small"
//                     icon={<PlusOutlined />}
//                     onClick={() => {
//                       setModalOpen(false);
//                       history.push('/agents/models');
//                     }}
//                   >
//                     去添加模型
//                   </Button>
//                 </div>
//               }
//             />
//           </Form.Item>
//           <ProFormTextArea
//             name="systemPrompt"
//             label="System Prompt"
//             placeholder="定义智能体的角色和行为"
//             fieldProps={{ rows: 4 }}
//           />
//           <Form.Item
//             name="tools"
//             label="工具"
//             tooltip="手动指定该智能体可使用的工具（需先在 Tools 页面启用）"
//           >
//             <Select
//               mode="multiple"
//               placeholder={enabledTools.length > 0 ? '选择工具' : '请先在 Tools 页面启用工具'}
//               options={enabledTools.map((t) => ({ label: t.name, value: t.id }))}
//               allowClear
//               disabled={enabledTools.length === 0}
//             />
//           </Form.Item>
//           <Form.Item name="active" label="启用状态" valuePropName="checked" tooltip="停用后该智能体将不可被调用">
//             <Switch checkedChildren="启用" unCheckedChildren="停用" />
//           </Form.Item>
//         </Form>
//       </Modal>
//     </PageContainer>
//   );
// };

/**
 * 智能体管理页面
 * 功能：智能体列表展示、新建、编辑、删除、启停状态切换；表单弹窗复用创建/编辑逻辑
 */
const AgentsPage: React.FC = () => {
  // 智能体列表状态
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  // 模型下拉选项数据源
  const [models, setModels] = useState<ModelConfig[]>([]);
  // 全部工具数据源
  const [tools, setTools] = useState<ToolConfig[]>([]);
  // 全局加载状态
  const [loading, setLoading] = useState(false);
  // 弹窗显示控制
  const [modalOpen, setModalOpen] = useState(false);
  // 当前编辑的智能体对象，null=新建模式
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  // antd Form 实例，管理弹窗表单数据、校验、重置
  const [form] = Form.useForm();

  /**
   * 重载页面数据
   * 并行拉取 agents、models、tools 三组接口，减少请求耗时；请求期间置loading
   */
  const reload = async () => {
    setLoading(true);
    try {
      // Promise.all 并行请求三个列表接口
      const [a, m, t] = await Promise.all([listAgents(), listModels(), listTools()]);
      setAgents(a);
      setModels(m);
      setTools(t);
    } finally {
      // 无论成功失败，关闭loading
      setLoading(false);
    }
  };

  // 组件首次挂载时执行一次数据加载
  useEffect(() => {
    reload();
  }, []);

  /**
   * 打开新建智能体弹窗
   * 清空编辑标记、重置表单，填充新建默认值：空工具、默认启用 active=1
   */
  const openCreate = () => {
    setEditingAgent(null);
    form.resetFields();
    form.setFieldsValue({ tools: [], active: 1 });
    setModalOpen(true);
  };

  /**
   * 打开编辑智能体弹窗
   * 回填当前智能体已有字段到表单，缺失字段兜底默认值
   * @param agent 待编辑的智能体数据
   */
  const openEdit = (agent: AgentConfig) => {
    setEditingAgent(agent);
    form.setFieldsValue({
      name: agent.name,
      description: agent.description,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools ?? [],
      active: agent.active ?? 1,
    });
    setModalOpen(true);
  };

  /**
   * 表单提交处理（新建/编辑复用）
   * 校验表单 → 组装提交payload → 判断模式调用新增或更新接口 → 关闭弹窗、刷新列表
   */
  const handleSubmit = async () => {
    try {
      // 触发表单校验，校验失败会抛出异常进入catch
      const values = await form.validateFields();
      // 统一整理提交载荷，布尔开关转为后端约定 1/0
      const payload = {
        ...values,
        tools: values.tools ?? [],
        active: values.active ? 1 : 0,
      };
      if (editingAgent) {
        // 编辑模式：调用更新接口
        await updateAgent(editingAgent.id, payload);
        message.success('智能体已更新');
      } else {
        // 新建模式：调用创建接口
        await createAgent(payload);
        message.success('智能体已创建');
      }
      setModalOpen(false);
      reload();
    } catch {
      // 表单校验失败、接口异常直接捕获，不额外toast（可按需补充错误提示）
    }
  };

  /**
   * 删除智能体
   * @param id 智能体唯一id
   */
  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    message.success('智能体已删除');
    reload();
  };

  /**
   * 单独切换智能体启用/停用状态
   * @param agent 目标智能体
   * @param checked Switch开关布尔值
   */
  const handleToggleActive = async (agent: AgentConfig, checked: boolean) => {
    await updateAgent(agent.id, { active: checked ? 1 : 0 });
    message.success(checked ? '已启用' : '已停用');
    reload();
  };

  /**
   * 根据模型id，查找展示模型名称，找不到则原样返回id
   * @param model 模型id
   */
  const getModelName = (model: string) =>
    models.find((m) => m.id === model)?.name ?? model;

  // 过滤出已经启用的工具，用于工具下拉选择，未启用工具不允许选择
  const enabledTools = tools.filter((t) => t.enabled);

  return (
    <PageContainer
      header={{
        title: 'Agents',
        subTitle: '创建与管理智能体',
        extra: [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            创建智能体
          </Button>,
        ],
      }}
    >
      {/* 空状态：没有智能体时展示Empty提示 */}
      {agents.length === 0 ? (
        <Card>
          <Empty
            description="还没有智能体，点击右上角「创建智能体」开始"
            style={{ padding: 40 }}
          />
        </Card>
      ) : (
        // 智能体卡片网格布局，响应式
        <Row gutter={[16, 16]}>
          {agents.map((agent) => {
            // 判断当前智能体启用状态
            const isActive = agent.active === 1;
            return (
              <Col xs={24} sm={12} md={8} lg={6} key={agent.id}>
                <Card
                  hoverable
                  style={{ height: '100%' }}
                  // 卡片底部操作按钮组
                  actions={[
                    <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(agent)}>
                      编辑
                    </Button>,
                    <Popconfirm title="确认删除该智能体？" onConfirm={() => handleDelete(agent.id)}>
                      <Button type="text" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <Card.Meta
                    avatar={<RobotOutlined style={{ fontSize: 32 }} />}
                    title={
                      <Space>
                        <Title level={5} style={{ margin: 0 }}>{agent.name}</Title>
                        {/* 启用状态标签，绿色=启用 */}
                        <Tag color={isActive ? 'green' : 'default'}>
                          {isActive ? '启用' : '停用'}
                        </Tag>
                      </Space>
                    }
                    description={<Text type="secondary">{agent.description || '暂无描述'}</Text>}
                  />
                  <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 8 }}>
                    模型：<Tag color="blue">{getModelName(agent.model)}</Tag>
                  </Paragraph>
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">工具：</Text>
                    {(agent.tools ?? []).length === 0 ? (
                      <Text type="secondary">未配置</Text>
                    ) : (
                      <Space size={[4, 4]} wrap>
                        {agent.tools.map((toolId) => {
                          const t = tools.find((x) => x.id === toolId);
                          return (
                            <Tag key={toolId} color="geekblue">
                              {t?.name ?? toolId}
                            </Tag>
                          );
                        })}
                      </Space>
                    )}
                  </div>
                  <div>
                    <Space>
                      <Text type="secondary">启用状态</Text>
                      {/* 启停开关，单独调用更新接口 */}
                      <Switch
                        checked={isActive}
                        onChange={(checked) => handleToggleActive(agent, checked)}
                      />
                    </Space>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* 创建/编辑共用弹窗，destroyOnClose：关闭销毁表单实例 */}
      <Modal
        title={editingAgent ? '编辑智能体' : '创建智能体'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <ProFormText name="name" label="名称" placeholder="例如：代码助手" rules={[{ required: true, message: '请输入名称' }]} />
          <ProFormTextArea name="description" label="描述" placeholder="智能体的简要说明" />
          <Form.Item
            name="model"
            label="模型"
            rules={[{ required: true, message: '请选择模型' }]}
            tooltip="请先在「Models」页面添加模型配置"
          >
            <Select
              placeholder={models.length > 0 ? '请选择模型' : '请先前往 Models 页面添加模型'}
              options={models.map((m) => ({ label: m.name, value: m.id }))}
              notFoundContent={
                <div style={{ padding: 12, textAlign: 'center' }}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <span>
                        暂无可用模型
                        <br />
                        请先前往「Models」页面添加
                      </span>
                    }
                  />
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setModalOpen(false);
                      history.push('/agents/models');
                    }}
                  >
                    去添加模型
                  </Button>
                </div>
              }
            />
          </Form.Item>
          <ProFormTextArea
            name="systemPrompt"
            label="System Prompt"
            placeholder="定义智能体的角色和行为"
            fieldProps={{ rows: 4 }}
          />
          <Form.Item
            name="tools"
            label="工具"
            tooltip="手动指定该智能体可使用的工具（需先在 Tools 页面启用）"
          >
            <Select
              mode="multiple"
              placeholder={enabledTools.length > 0 ? '选择工具' : '请先在 Tools 页面启用工具'}
              options={enabledTools.map((t) => ({ label: t.name, value: t.id }))}
              allowClear
              disabled={enabledTools.length === 0}
            />
          </Form.Item>
          {/* valuePropName: Switch组件绑定的值是checked，不是默认value */}
          <Form.Item name="active" label="启用状态" valuePropName="checked" tooltip="停用后该智能体将不可被调用">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};


export default AgentsPage;
