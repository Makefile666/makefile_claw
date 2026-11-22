import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { PageContainer, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  InputNumber,
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
import React, { useEffect, useMemo, useState } from 'react';

import {
  createTeam,
  deleteTeam,
  listAgents,
  listTeams,
  updateTeam,
} from './service';

import type { AgentConfig, TeamConfig, TeamMode } from './types';

const { Title, Text } = Typography;

/** 协作模式中文标签映射 */
const MODE_LABELS: Record<TeamMode, string> = {
  hierarchy: '层级委派',
  pipeline: '流水线',
  parallel: '并行分治',
};

/** 协作模式下拉选项 */
const MODE_OPTIONS = (Object.keys(MODE_LABELS) as TeamMode[]).map((m) => ({
  label: MODE_LABELS[m],
  value: m,
}));

/**
 * 多智能体团队编排页面
 * 功能：团队列表展示、新建、编辑、删除、启停状态切换；
 * 主管 / Worker 下拉数据来自 agents 列表（复用 listAgents 接口）。
 */
const TeamsPage: React.FC = () => {
  // 团队列表状态
  const [teams, setTeams] = useState<TeamConfig[]>([]);
  // 可用 Agent 列表（主管 / Worker 下拉数据源）
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  // 全局加载状态
  const [loading, setLoading] = useState(false);
  // 弹窗显示控制
  const [modalOpen, setModalOpen] = useState(false);
  // 当前编辑的团队对象，null=新建模式
  const [editingTeam, setEditingTeam] = useState<TeamConfig | null>(null);
  // antd Form 实例
  const [form] = Form.useForm();

  /**
   * 一、重载页面数据：拉取团队列表 + Agent 列表（供下拉选择）
   */
  const reload = async () => {
    setLoading(true);
    try {
      const [teamList, agentList] = await Promise.all([listTeams(), listAgents()]);
      setTeams(teamList);
      setAgents(agentList);
    } finally {
      setLoading(false);
    }
  };

  // 组件首次挂载时执行一次数据加载
  useEffect(() => {
    reload();
  }, []);

  /** Agent 下拉候选：仅展示已启用的 Agent（与 chatbot 选择口径一致） */
  const agentOptions = useMemo(
    () =>
      agents
        .filter((a) => a.active === 1)
        .map((a) => ({ label: a.name, value: a.name })),
    [agents],
  );

  /**
   * 二、打开新建团队弹窗：重置表单，填充默认值（mode=hierarchy、maxParallelWorkers=3、active=1）
   */
  const openCreate = () => {
    setEditingTeam(null);
    form.resetFields();
    form.setFieldsValue({
      workers: [],
      mode: 'hierarchy',
      maxParallelWorkers: 3,
      active: true,
    });
    setModalOpen(true);
  };

  /**
   * 三、打开编辑团队弹窗：回填当前团队已有字段
   */
  const openEdit = (team: TeamConfig) => {
    setEditingTeam(team);
    form.setFieldsValue({
      name: team.name,
      description: team.description ?? '',
      supervisor: team.supervisor,
      workers: team.workers ?? [],
      mode: team.mode ?? 'hierarchy',
      maxParallelWorkers: team.maxParallelWorkers ?? 3,
      active: (team.active ?? 1) === 1,
    });
    setModalOpen(true);
  };

  /**
   * 四、表单提交处理（新建/编辑复用）
   */
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // Switch → 0/1；其余字段直接透传
      const payload: TeamConfig = {
        name: values.name,
        description: values.description ?? '',
        supervisor: values.supervisor,
        workers: values.workers ?? [],
        mode: values.mode ?? 'hierarchy',
        maxParallelWorkers: values.maxParallelWorkers ?? 3,
        active: values.active ? 1 : 0,
      };
      if (editingTeam) {
        // 编辑模式：name 不可改（作为唯一键定位），但后端允许整体覆盖
        await updateTeam(editingTeam.name, payload);
        message.success('团队已更新');
      } else {
        await createTeam(payload);
        message.success('团队已创建');
      }
      setModalOpen(false);
      reload();
    } catch {
      // 表单校验失败、接口异常直接捕获
    }
  };

  /**
   * 五、删除团队
   */
  const handleDelete = async (name: string) => {
    await deleteTeam(name);
    message.success('团队已删除');
    reload();
  };

  /**
   * 单独切换团队启用/停用状态
   */
  const handleToggleActive = async (team: TeamConfig, checked: boolean) => {
    await updateTeam(team.name, { active: checked ? 1 : 0 });
    message.success(checked ? '已启用' : '已停用');
    reload();
  };

  return (
    <PageContainer
      header={{
        title: '团队编排',
        subTitle: '创建与管理多智能体团队（主管 + Worker 协作）',
        extra: [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            创建团队
          </Button>,
        ],
      }}
    >
      {teams.length === 0 ? (
        <Card loading={loading}>
          <Empty
            description="还没有团队，点击右上角「创建团队」开始"
            style={{ padding: 40 }}
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {teams.map((team) => {
            const isActive = (team.active ?? 1) === 1;
            const mode = team.mode ?? 'hierarchy';
            return (
              <Col xs={24} sm={12} md={8} lg={6} key={team.name}>
                <Card
                  hoverable
                  style={{ height: '100%' }}
                  actions={[
                    <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(team)}>
                      编辑
                    </Button>,
                    <Popconfirm title="确认删除该团队？" onConfirm={() => handleDelete(team.name)}>
                      <Button type="text" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <Card.Meta
                    avatar={<TeamOutlined style={{ fontSize: 32 }} />}
                    title={
                      <Space>
                        <Title level={5} style={{ margin: 0 }}>
                          {team.name}
                        </Title>
                        <Tag color={isActive ? 'green' : 'default'}>
                          {isActive ? '启用' : '停用'}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Text type="secondary">{team.description || '暂无描述'}</Text>
                    }
                  />
                  <div style={{ marginTop: 12, marginBottom: 8 }}>
                    <Space size={[4, 4]} wrap>
                      <Text type="secondary">模式：</Text>
                      <Tag color="purple">{MODE_LABELS[mode]}</Tag>
                      <Text type="secondary">最大并行：</Text>
                      <Tag color="blue">{team.maxParallelWorkers ?? 3}</Tag>
                    </Space>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">主管：</Text>
                    <Tag color="gold">{team.supervisor || '未配置'}</Tag>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">Worker：</Text>
                    {(team.workers ?? []).length === 0 ? (
                      <Text type="secondary">未配置</Text>
                    ) : (
                      <Space size={[4, 4]} wrap>
                        {team.workers.map((w) => (
                          <Tag key={w} color="geekblue">
                            {w}
                          </Tag>
                        ))}
                      </Space>
                    )}
                  </div>
                  <div>
                    <Space>
                      <Text type="secondary">启用状态</Text>
                      <Switch
                        checked={isActive}
                        onChange={(checked) => handleToggleActive(team, checked)}
                      />
                    </Space>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* 创建/编辑共用弹窗 */}
      <Modal
        title={editingTeam ? '编辑团队' : '创建团队'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <ProFormText
            name="name"
            label="名称"
            placeholder="例如：研发小组"
            rules={[{ required: true, message: '请输入团队名称' }]}
            disabled={!!editingTeam}
          />
          <ProFormTextArea name="description" label="描述" placeholder="团队的简要说明" />
          <Form.Item
            name="supervisor"
            label="主管 Agent"
            rules={[{ required: true, message: '请选择主管 Agent' }]}
            tooltip="主管负责拆解任务并委派给 Worker（需先在 Agents 页面启用）"
          >
            <Select
              placeholder={
                agentOptions.length > 0 ? '请选择主管 Agent' : '请先前往 Agents 页面启用 Agent'
              }
              options={agentOptions}
              notFoundContent={
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无可用 Agent，请先在 Agents 页面启用"
                />
              }
            />
          </Form.Item>
          <Form.Item
            name="workers"
            label="Worker Agent（多选）"
            rules={[{ required: true, message: '请至少选择一个 Worker' }]}
            tooltip="主管可委派任务的执行者列表"
          >
            <Select
              mode="multiple"
              allowClear
              placeholder={
                agentOptions.length > 0 ? '选择 Worker（可多选）' : '请先前往 Agents 页面启用 Agent'
              }
              options={agentOptions}
              maxTagCount="responsive"
              notFoundContent={
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无可用 Agent"
                />
              }
            />
          </Form.Item>
          <Form.Item
            name="mode"
            label="协作模式"
            tooltip="hierarchy=主管动态委派；pipeline=固定流水线；parallel=并行分治"
          >
            <Select options={MODE_OPTIONS} />
          </Form.Item>
          <Form.Item name="maxParallelWorkers" label="最大并行 Worker 数" tooltip="全局并发上限，缺省 3">
            <InputNumber min={1} max={32} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="active"
            label="启用状态"
            valuePropName="checked"
            tooltip="停用后该团队不可在聊天页选择"
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default TeamsPage;
