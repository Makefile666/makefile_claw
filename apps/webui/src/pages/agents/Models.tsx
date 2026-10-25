import {
  CloudOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { PageContainer, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Space,
  Slider,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import React, { useEffect, useState } from 'react';

import {
  createModel,
  deleteModel,
  getMakefileClawModelsConfig,
  updateModel,
} from './service';
import type { ModelConfig } from './types';

const { Title, Text, Paragraph } = Typography;

const PROVIDER_OPTIONS = [
  'OpenAI',
  'Azure OpenAI',
  'Anthropic',
  'Google',
  'DeepSeek',
  'Moonshot',
  'Zhipu',
  'Qwen',
  'Ollama',
  'OpenAI-Compatible',
];


/**
 * 模型配置管理页面
 * 功能：模型配置列表展示、新增、编辑、删除；API密钥脱敏展示，复用弹窗完成新增/编辑
 */
const ModelsPage: React.FC = () => {
  // 模型配置列表数据源
  const [models, setModels] = useState<ModelConfig[]>([]);
  // 弹窗显示开关
  const [modalOpen, setModalOpen] = useState(false);
  // 当前编辑模型，null代表新建模式
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  // antd Form实例，管理表单校验、回填、重置
  const [form] = Form.useForm();
  // 跟踪「从环境变量读取 API Key」开关状态，用于联动 api_key 输入框的标签与占位提示
  const [apiKeyFromEnv, setApiKeyFromEnv] = useState(false);

  /**
   * 一、刷新模型列表
   * 请求后端接口，获取全部模型配置并更新状态
   */
  const reload = async () => {
    setModels(await getMakefileClawModelsConfig());
  };

  // 组件首次挂载，加载模型数据
  useEffect(() => {
    reload();
  }, []);

  /**
   * 二、打开新增模型弹窗
   * 清空编辑标记，重置表单，设置temperature默认值0.7
   */
  const openCreate = () => {
    setEditingModel(null);
    form.resetFields();
    form.setFieldsValue({ temperature: 0.7, active: 1, api_key_from_env: false });
    setApiKeyFromEnv(false);
    setModalOpen(true);
  };

  /**
   * 三、打开编辑模型弹窗
   * 将选中模型的所有字段回填到表单
   * @param model 待编辑的模型配置对象
   */
  const openEdit = (model: ModelConfig) => {
    setEditingModel(model);
    form.setFieldsValue({
      name: model.name,
      provider: model.provider,
      base_url: model.base_url,
      api_key: model.api_key,
      id: model.id,
      temperature: model.temperature,
      active: model.active ?? 1,
      api_key_from_env: model.api_key_from_env === 1,
      description: model.description,
    });
    setApiKeyFromEnv(model.api_key_from_env === 1);
    setModalOpen(true);
  };

  /**
   * 四、表单提交逻辑，新增/编辑共用  
   * 校验表单字段，根据editingModel判断走新增或更新接口，成功后关闭弹窗刷新列表
   */
  const handleSubmit = async () => {
    try {
      // 触发表单校验，校验失败抛出异常进入catch
      const values = await form.validateFields();
      // active / api_key_from_env 开关布尔值转为后端约定的 1/0
      const payload = {
        ...values,
        active: values.active ? 1 : 0,
        api_key_from_env: values.api_key_from_env ? 1 : 0,
      };
      if (editingModel) {
        // 编辑模式：调用更新接口（按 name 定位）
        await updateModel(editingModel.name, payload);
        message.success('模型配置已更新');
      } else {
        // 新增模式：调用创建接口
        await createModel(payload);
        message.success('模型配置已创建');
      }
      setModalOpen(false);
      reload();
    } catch {
      // 捕获表单校验异常，不额外提示
    }
  };

  /**
   * 五、删除模型配置
   * @param name 模型唯一标识（name）
   */
  const handleDelete = async (name: string) => {
    await deleteModel(name);
    message.success('模型配置已删除');
    reload();
  };

  /**
   * 单独切换模型启用/停用状态
   * @param model 目标模型
   * @param checked Switch开关布尔值
   */
  const handleToggleActive = async (model: ModelConfig, checked: boolean) => {
    await updateModel(model.name, { active: checked ? 1 : 0 });
    message.success(checked ? '已启用' : '已停用');
    reload();
  };

  /**
   * 六、API密钥脱敏处理
   * 只保留首尾各4位，中间用星号遮挡，防止密钥明文展示
   * @param key api密钥字符串
   */
  const maskApiKey = (key: string) => {
    if (!key) return '未设置';
    if (key.length <= 8) return '•'.repeat(key.length);
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  };

  return (
    <PageContainer
      header={{
        title: 'Models',
        subTitle: '配置大模型服务接入',
        extra: [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加模型
          </Button>,
        ],
      }}
    >
      {/* 空状态：暂无模型配置时展示提示 */}
      {models.length === 0 ? (
        <Card>
          <Empty
            description="还没有模型配置，点击右上角「添加模型」开始"
            style={{ padding: 40 }}
          />
        </Card>
      ) : (
        // 响应式卡片网格
        <Row gutter={[16, 16]}>
          {models.map((model) => {
            const isActive = model.active === 1;
            const useEnvVar = model.api_key_from_env === 1;
            return (
            <Col xs={24} sm={12} md={8} lg={6} key={model.name}>
              <Card
                hoverable
                style={{ height: '100%' }}
                // 卡片底部操作按钮：编辑、删除
                actions={[
                  <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(model)}>
                    编辑
                  </Button>,
                  <Popconfirm title="确认删除该模型配置？" onConfirm={() => handleDelete(model.name)}>
                    <Button type="text" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={<CloudOutlined style={{ fontSize: 32 }} />}
                  title={
                    <Space>
                      <Title level={5} style={{ margin: 0 }}>{model.name}</Title>
                      <Tag color={isActive ? 'green' : 'default'}>
                        {isActive ? '启用' : '停用'}
                      </Tag>
                      {useEnvVar && <Tag color="cyan">环境变量</Tag>}
                    </Space>
                  }
                  description={<Text type="secondary">{model.description || '暂无描述'}</Text>}
                />
                <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 8 }}>
                  <Space direction="vertical" size={4}>
                    <span>服务商：<Tag color="purple">{model.provider}</Tag></span>
                    <span>模型：<Tag color="blue">{model.id}</Tag></span>
                    <span>Temperature：<Tag color="orange">{model.temperature}</Tag></span>
                    <span>Base URL：<Text code>{model.base_url || '-'}</Text></span>
                    <span>
                      API Key：
                      {model.api_key_from_env === 1 ? (
                        <>
                          <Tag color="cyan">环境变量</Tag>
                          <Text code>{model.api_key || '-'}</Text>
                        </>
                      ) : (
                        <Text code>{maskApiKey(model.api_key)}</Text>
                      )}
                    </span>
                  </Space>
                </Paragraph>
                <div>
                  <Space>
                    <Text type="secondary">启用状态</Text>
                    <Switch
                      checked={isActive}
                      onChange={(checked) => handleToggleActive(model, checked)}
                    />
                  </Space>
                </div>
              </Card>
            </Col>
            );
          })}
        </Row>
      )}

      {/* 新增/编辑共用弹窗，关闭时销毁表单实例 */}
      <Modal
        title={editingModel ? '编辑模型配置' : '添加模型配置'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          onValuesChange={(changed) => {
            // 监听 api_key_from_env 开关变化，同步状态以联动 api_key 输入框
            if ('api_key_from_env' in changed) {
              setApiKeyFromEnv(!!changed.api_key_from_env);
            }
          }}
        >
          <ProFormText name="name" label="名称" placeholder="例如：GPT-4o" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Item
            name="provider"
            label="服务商"
            rules={[{ required: true, message: '请选择服务商' }]}
          >
            {/* input + datalist 支持下拉预选，也支持手动输入自定义服务商 */}
            <Input
              placeholder="选择或输入服务商"
              list="provider-options"
            />
          </Form.Item>
          {/* 预定义服务商候选列表，供输入提示 */}
          <datalist id="provider-options">
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <ProFormText name="id" label="Model ID" placeholder="例如：gpt-4o" rules={[{ required: true, message: '请输入 Model ID' }]} />
          <ProFormText name="base_url" label="Base URL" placeholder="例如：https://api.openai.com/v1" />
          <Form.Item
            name="api_key"
            label={apiKeyFromEnv ? '环境变量名' : 'API Key'}
            rules={[{ required: true, message: apiKeyFromEnv ? '请输入环境变量名' : '请输入 API Key' }]}
          >
            {/* 开启环境变量模式时填变量名（明文），关闭时填真实密钥（密码框） */}
            {apiKeyFromEnv ? (
              <Input placeholder="例如：OPENAI_API_KEY" />
            ) : (
              <Input.Password placeholder="sk-..." />
            )}
          </Form.Item>
          {/* API Key 来源开关：开启时 api_key 字段存储环境变量名，后端运行时从 process.env 解析 */}
          <Form.Item
            name="api_key_from_env"
            label="从环境变量读取 API Key"
            valuePropName="checked"
            tooltip="开启后，上方输入框填写环境变量名（如 OPENAI_API_KEY），后端运行时自动从该环境变量读取真实密钥"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item
            name="temperature"
            label="Temperature"
            rules={[{ required: true, message: '请设置 Temperature' }]}
            tooltip="采样温度，值越高回答越随机，越低越确定"
          >
            {/* 滑块组件快速调节温度 */}
            <Slider
              min={0}
              max={2}
              step={0.1}
              marks={{ 0: '0', 0.7: '0.7', 1: '1', 2: '2' }}
            />
          </Form.Item>
          {/* 数字输入框和滑块双向联动，精准填写数值 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="temperature" noStyle>
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          {/* 启用状态：valuePropName=checked 绑定 Switch 的 checked 属性 */}
          <Form.Item name="active" label="启用状态" valuePropName="checked" tooltip="停用后该模型不可被智能体选用">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <ProFormTextArea name="description" label="描述" placeholder="该模型配置的用途说明" />
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default ModelsPage;