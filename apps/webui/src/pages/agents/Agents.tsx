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
  getMakefileClawAgentsConfig,
  updateAgent,
} from './service';

import type { AgentConfig, ModelConfig, ToolConfig } from './types';

const { Title, Text, Paragraph } = Typography;

import { useMemo } from 'react';


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

  // 新增状态，保存表单选中值
  const [selectedValues, setSelectedValues] = useState<{
    model?: string;
    tools?: string[];
  }>({});

  // 过滤：只保留启用状态(active=1)的模型；
  // 编辑场景下若已选中了一个停用模型，也保留它以便用户可见并可切换
  const availableModels = useMemo(() => {
    return models.filter(
      (item) => item.active === 1 || item.name === selectedValues.model,
    );
  }, [models, selectedValues.model]);

  // 过滤出已经启用的工具，用于工具下拉选择，未启用工具不允许选择
  // const enabledTools = tools.filter((t) => t.enabled);
  const enabledTools = useMemo(() => {
    // 只要 active=1（已启用）的工具都可选，不区分内置/自定义
    return tools.filter(t => t.active === 1);
  }, [tools]);

  // 过滤：剔除已经选中的工具
  const availableTools = useMemo(() => {
    // 候选池 = 启用的工具，再排除已经勾选的
    return enabledTools.filter(item => !selectedValues.tools?.includes(item.name));
  }, [enabledTools, selectedValues.tools]);

  // 是否已经把所有启用工具全部选中
  const allToolsSelected = useMemo(() => {
    if (!selectedValues.tools) return false;
    return selectedValues.tools.length === enabledTools.length;
  }, [selectedValues.tools, enabledTools]);

  /**
   * 一、重载页面数据
   * 调用后端接口一次性拉取 agents、models、tools 三组数据，减少请求耗时；请求期间置loading
   */
  const reload = async () => {
    setLoading(true);
    try {
      // 单次请求获取完整配置（agents + models + tools）
      const { agents: a, models: m, tools: t } = await getMakefileClawAgentsConfig();
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
   * 二、打开新建智能体弹窗
   * 清空编辑标记、重置表单，填充新建默认值：空工具、默认启用 active=1
   */
  const openCreate = () => {
    setEditingAgent(null);
    form.resetFields();
    form.setFieldsValue({ tools: [], active: 1 });
    // 手动同步选中值到state：新建时无模型、工具为空
    setSelectedValues({ model: undefined, tools: [] });
    setModalOpen(true);
  };

  /**
   * 三、打开编辑智能体弹窗
   * 回填当前智能体已有字段到表单，缺失字段兜底默认值
   * @param agent 待编辑的智能体数据
   */
  const openEdit = (agent: AgentConfig) => {
    setEditingAgent(agent);
    // labelInValue 需要回填 { label, value }，确保选中框显示名称而非name
    const modelLabel = getModelName(agent.model);
    const toolsLabeled = (agent.tools ?? []).map((toolName) => ({
      label: tools.find((t) => t.name === toolName)?.name ?? toolName,
      value: toolName,
    }));
    form.setFieldsValue({
      name: agent.name,
      description: agent.description,
      model: { label: modelLabel, value: agent.model },
      systemPrompt: agent.systemPrompt,
      tools: toolsLabeled,
      active: agent.active ?? 1,
    });
    // 手动同步选中值到state，供下拉过滤使用
    setSelectedValues({ model: agent.model, tools: agent.tools ?? [] });
    setModalOpen(true);
  };

  /**
   * 四、表单提交处理（新建/编辑复用）
   * 校验表单 → 组装提交payload → 判断模式调用新增或更新接口 → 关闭弹窗、刷新列表
   */
  const handleSubmit = async () => {
    try {
      // 触发表单校验，校验失败会抛出异常进入catch
      const values = await form.validateFields();
      // labelInValue 结构：model 为 {label,value}，tools 为 {label,value}[]，需提取 value
      const payload = {
        ...values,
        model: values.model?.value,
        tools: (values.tools ?? []).map((t: { label: React.ReactNode; value: string }) => t.value),
        active: values.active ? 1 : 0,
      };
      if (editingAgent) {
        // 编辑模式：调用更新接口（按 name 定位）
        await updateAgent(editingAgent.name, payload);
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
   * 五、删除智能体
   * @param name 智能体名称（唯一标识）
   */
  const handleDelete = async (name: string) => {
    await deleteAgent(name);
    message.success('智能体已删除');
    reload();
  };

  /**
   * 单独切换智能体启用/停用状态
   * @param agent 目标智能体
   * @param checked Switch开关布尔值
   */
  const handleToggleActive = async (agent: AgentConfig, checked: boolean) => {
    await updateAgent(agent.name, { active: checked ? 1 : 0 });
    message.success(checked ? '已启用' : '已停用');
    reload();
  };

  /**
   * 六、根据模型 name（唯一标识）查找模型，展示其 name；找不到则原样返回
   * @param model 模型 name
   */
  const getModelName = (model: string) =>
    models.find((m) => m.name === model)?.name ?? model;


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
              <Col xs={24} sm={12} md={8} lg={6} key={agent.name}>
                <Card
                  hoverable
                  style={{ height: '100%' }}
                  // 卡片底部操作按钮组
                  actions={[
                    <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(agent)}>
                      编辑
                    </Button>,
                    <Popconfirm title="确认删除该智能体？" onConfirm={() => handleDelete(agent.name)}>
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
                        {agent.tools.map((toolName) => {
                          const t = tools.find((x) => x.name === toolName);
                          return (
                            <Tag key={toolName} color="geekblue">
                              {t?.name ?? toolName}
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
        <Form form={form} layout="vertical" preserve={false}
        onValuesChange={(_, allValues) => {
          setSelectedValues({
            // labelInValue 下 model/tools 为 {label,value}，取 value(id) 用于下拉过滤
            model: allValues.model?.value,
            tools: (allValues.tools ?? []).map((t: { label: React.ReactNode; value: string }) => t.value),
          });
        }}>
          <ProFormText name="name" label="名称" placeholder="例如：代码助手" rules={[{ required: true, message: '请输入名称' }]} />
          <ProFormTextArea name="description" label="描述" placeholder="智能体的简要说明" />
          <Form.Item
            name="model"
            label="模型"
            rules={[{ required: true, message: '请选择模型' }]}
            tooltip="请先在「Models」页面添加模型配置"
          >
            <Select
              labelInValue
              placeholder={availableModels.length > 0 ? '请选择模型' : '请先前往 Models 页面添加模型'}
              options={availableModels.map((m) => ({ label: m.name, value: m.name }))}
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
              labelInValue
              placeholder={enabledTools.length > 0 ? '选择工具' : '请先在 Tools 页面启用工具'}
              options={availableTools.map((t) => ({ label: t.name, value: t.name }))}
              allowClear
              notFoundContent={
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={allToolsSelected ? '已选择全部工具' : '暂无更多工具'}
                />
              }
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
