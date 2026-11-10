import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  LinkOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import React, { useEffect, useState } from 'react';

import {
  deleteSkill,
  getSkill,
  installSkill,
  listSkills,
  toggleSkillActive,
} from './service';
import type { SkillConfig } from './types';

const { Title, Text, Paragraph } = Typography;

/**
 * 格式化 ISO 时间字符串为本地可读时间
 */
const formatTime = (iso?: string): string => {
  if (!iso) return '未知';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
};

/**
 * Skills 技能管理页面
 *
 * 功能：
 * - 展示已安装的技能列表（横向卡片：名称、描述、来源、安装时间、安装指令）
 * - 启用/停用技能（停用后不会注入到 Agent）
 * - 通过 skills.sh 站点提供的安装命令安装新技能
 * - 查看技能正文内容（SKILL.md 规范文档）
 * - 删除已安装技能
 */
const SkillsPage: React.FC = () => {
  // 已安装技能列表
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  // 加载状态
  const [loading, setLoading] = useState(false);
  // 安装弹窗显示控制
  const [installOpen, setInstallOpen] = useState(false);
  // 安装中状态
  const [installing, setInstalling] = useState(false);
  // 查看技能详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  // 当前查看的技能详情
  const [detailSkill, setDetailSkill] = useState<SkillConfig | null>(null);
  // 切换启用状态时的 loading（按技能名记录）
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  // antd Form 实例（安装命令输入）
  const [form] = Form.useForm();

  /**
   * 一、刷新技能列表
   */
  const reload = async () => {
    setLoading(true);
    try {
      setSkills(await listSkills());
    } finally {
      setLoading(false);
    }
  };

  // 首次挂载加载
  useEffect(() => {
    reload();
  }, []);

  /**
   * 二、打开安装弹窗
   */
  const openInstall = () => {
    form.resetFields();
    setInstallOpen(true);
  };

  /**
   * 三、执行技能安装
   */
  const handleInstall = async () => {
    try {
      const values = await form.validateFields();
      const command = (values.command as string).trim();
      if (!command) {
        message.warning('请输入安装命令');
        return;
      }
      setInstalling(true);
      await installSkill(command);
      message.success('技能安装成功');
      setInstallOpen(false);
      reload();
    } catch (e: any) {
      console.error('[skills] install failed:', e);
    } finally {
      setInstalling(false);
    }
  };

  /**
   * 四、查看技能详情
   */
  const handleView = async (skill: SkillConfig) => {
    try {
      const detail = skill.content ? skill : await getSkill(skill.name);
      setDetailSkill(detail);
      setDetailOpen(true);
    } catch (e) {
      console.error('[skills] get detail failed:', e);
    }
  };

  /**
   * 五、删除技能
   */
  const handleDelete = async (name: string) => {
    await deleteSkill(name);
    message.success('技能已删除');
    reload();
  };

  /**
   * 六、切换技能启用状态
   */
  const handleToggleActive = async (skill: SkillConfig, active: boolean) => {
    setToggling((prev) => ({ ...prev, [skill.name]: true }));
    try {
      const updated = await toggleSkillActive(skill.name, active);
      setSkills((prev) =>
        prev.map((s) => (s.name === skill.name ? updated : s)),
      );
      message.success(active ? '已启用' : '已停用');
    } catch (e) {
      console.error('[skills] toggle active failed:', e);
      message.error('操作失败');
    } finally {
      setToggling((prev) => ({ ...prev, [skill.name]: false }));
    }
  };

  return (
    <PageContainer
      header={{
        title: 'Skills',
        subTitle: '安装与管理技能（Skills），扩展 Agent 能力',
        extra: [
          <Button
            key="install"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={openInstall}
          >
            安装技能
          </Button>,
        ],
      }}
    >
      {/* 空状态 */}
      {skills.length === 0 ? (
        <Card>
          <Empty
            description={
              <span>
                还没有安装技能
                <br />
                点击右上角「安装技能」，粘贴 skills.sh 提供的安装命令开始
              </span>
            }
            style={{ padding: 40 }}
          />
        </Card>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {skills.map((skill) => (
            <Card
              key={skill.name}
              hoverable
              style={{
                opacity: skill.active ? 1 : 0.6,
                transition: 'opacity 0.2s',
              }}
              bodyStyle={{ padding: '16px 24px' }}
            >
              {/* 横向布局：左侧图标+标题，中间描述+元数据，右侧操作 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 20,
                }}
              >
                {/* 左侧：图标 + 名称 + 版本 + 启用状态 */}
                <div
                  style={{
                    flex: '0 0 200px',
                    minWidth: 180,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ThunderboltOutlined
                      style={{ fontSize: 22, color: '#1677ff' }}
                    />
                    <Title level={5} style={{ margin: 0 }}>
                      {skill.name}
                    </Title>
                  </div>
                  {skill.version && (
                    <Tag color="blue" style={{ alignSelf: 'flex-start' }}>
                      v{skill.version}
                    </Tag>
                  )}
                  <Tag color={skill.active ? 'green' : 'default'}>
                    {skill.active ? '已启用' : '已停用'}
                  </Tag>
                </div>

                {/* 中间：描述 + 元数据（来源、安装时间、安装指令） */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* 技能描述 */}
                  <Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2, expandable: false }}
                    style={{ marginBottom: 0, fontSize: 14 }}
                  >
                    {skill.description || '暂无描述'}
                  </Paragraph>

                  {/* 来源 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Text type="secondary" style={{ flex: '0 0 auto', fontSize: 12 }}>
                      来源：
                    </Text>
                    {skill.source ? (
                      <Tooltip title={skill.source}>
                        <a
                          href={skill.source}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 12,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'inline-block',
                            maxWidth: 400,
                          }}
                        >
                          <LinkOutlined style={{ marginRight: 4 }} />
                          {skill.source}
                        </a>
                      </Tooltip>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>未知</Text>
                    )}
                  </div>

                  {/* 安装时间 + 安装指令 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 24,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        安装时间：
                      </Text>
                      <Text style={{ fontSize: 12 }}>
                        {formatTime(skill.installTime)}
                      </Text>
                    </div>
                    {skill.installCommand && (
                      <Tooltip title={skill.installCommand}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            maxWidth: 400,
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 12, flex: '0 0 auto' }}>
                            安装指令：
                          </Text>
                          <Text
                            code
                            style={{
                              fontSize: 12,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 320,
                            }}
                          >
                            {skill.installCommand}
                          </Text>
                        </div>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {/* 右侧：操作按钮 */}
                <div
                  style={{
                    flex: '0 0 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 12,
                  }}
                >
                  {/* 启用/停用开关 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StopOutlined style={{ color: skill.active ? undefined : '#ff4d4f' }} />
                    <Switch
                      checked={skill.active}
                      loading={toggling[skill.name]}
                      onChange={(checked) => handleToggleActive(skill, checked)}
                      checkedChildren="启用"
                      unCheckedChildren="停用"
                    />
                  </div>
                  {/* 查看 + 删除 */}
                  <Space>
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => handleView(skill)}
                    >
                      查看
                    </Button>
                    <Popconfirm
                      title="确认删除该技能？"
                      onConfirm={() => handleDelete(skill.name)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              </div>
            </Card>
          ))}
        </Space>
      )}

      {/* 安装技能弹窗 */}
      <Modal
        title="安装技能"
        open={installOpen}
        onOk={handleInstall}
        onCancel={() => setInstallOpen(false)}
        confirmLoading={installing}
        okText="安装"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="command"
            label="安装命令"
            rules={[{ required: true, message: '请输入安装命令' }]}
            tooltip="从 skills.sh 站点复制技能的安装命令，例如：npx skills add owner/repo"
          >
            <Input.TextArea
              rows={3}
              placeholder="粘贴 skills.sh 提供的安装命令，例如：&#10;npx skills add owner/repo"
            />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            安装命令会通过 pnpm dlx skills add 执行，技能将被安装到
            <Text code> ~/.makefile_claw/skills </Text>
            目录下。
          </Typography.Paragraph>
        </Form>
      </Modal>

      {/* 查看技能详情弹窗 */}
      <Modal
        title={detailSkill ? `技能详情：${detailSkill.name}` : '技能详情'}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailOpen(false)}>
            关闭
          </Button>,
        ]}
        width={800}
        destroyOnClose
      >
        {detailSkill && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">描述：</Text>
              <span>{detailSkill.description || '暂无'}</span>
            </div>
            {detailSkill.version && (
              <div>
                <Text type="secondary">版本：</Text>
                <Tag color="blue">v{detailSkill.version}</Tag>
              </div>
            )}
            {detailSkill.source && (
              <div>
                <Text type="secondary">来源：</Text>
                <a href={detailSkill.source} target="_blank" rel="noreferrer">
                  {detailSkill.source}
                </a>
              </div>
            )}
            {detailSkill.installTime && (
              <div>
                <Text type="secondary">安装时间：</Text>
                <span>{formatTime(detailSkill.installTime)}</span>
              </div>
            )}
            {detailSkill.allowedTools && detailSkill.allowedTools.length > 0 && (
              <div>
                <Text type="secondary">允许工具：</Text>
                <Space size={[4, 4]} wrap>
                  {detailSkill.allowedTools.map((t) => (
                    <Tag key={t} color="geekblue">
                      {t}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
            <div>
              <Text type="secondary">技能正文（SKILL.md）：</Text>
              <Card
                size="small"
                style={{ marginTop: 8, maxHeight: 400, overflow: 'auto' }}
              >
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {detailSkill.content || '（无正文内容）'}
                </pre>
              </Card>
            </div>
          </Space>
        )}
      </Modal>
    </PageContainer>
  );
};

export default SkillsPage;
