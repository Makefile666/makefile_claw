import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import React, { useEffect, useState } from 'react';

import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  toggleMcpServerActive,
  updateMcpServer,
} from './service';
import type { McpServerConfig } from './types';

const { Title, Text, Paragraph } = Typography;

/**
 * MCP 服务器管理页面
 * 功能：远程 MCP 服务器（Streamable HTTP）的增删改查，
 *      管理 name、url、headers（鉴权头）、active 开关；
 *      只有启用的服务器才能在 chatbot 页面被选择加载。
 */
const McpPage: React.FC = () => {
  // MCP 服务器列表数据源
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  // 弹窗显示开关
  const [modalOpen, setModalOpen] = useState(false);
  // 当前编辑的服务器，null 代表新建模式
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  // antd Form 实例
  const [form] = Form.useForm();

  /**
   * 刷新 MCP 服务器列表
   */
  const reload = async () => {
    setServers(await listMcpServers());
  };

  // 首次挂载加载数据
  useEffect(() => {
    reload();
  }, []);

  /**
   * 打开新增弹窗
   */
  const openCreate = () => {
    setEditingServer(null);
    form.resetFields();
    form.setFieldsValue({ active: 1, headers: '{}' });
    setModalOpen(true);
  };

  /**
   * 打开编辑弹窗，回填表单
   */
  const openEdit = (server: McpServerConfig) => {
    setEditingServer(server);
    form.setFieldsValue({
      name: server.name,
      url: server.url,
      headers: JSON.stringify(server.headers ?? {}, null, 2),
      active: server.active,
    });
    setModalOpen(true);
  };

  /**
   * 提交表单（新建或更新）
   */
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // headers 字段为 JSON 字符串，解析为对象；解析失败时给出明确提示
      let headers: Record<string, string> = {};
      const headersRaw = String(values.headers ?? '{}').trim();
      if (headersRaw) {
        try {
          const parsed = JSON.parse(headersRaw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            headers = parsed;
          } else {
            message.error('headers 必须是 JSON 对象');
            return;
          }
        } catch {
          message.error('headers 不是合法的 JSON');
          return;
        }
      }

      const payload = {
        name: values.name,
        url: values.url,
        headers,
        active: values.active ? 1 : 0,
      };

      if (editingServer) {
        await updateMcpServer(editingServer.name, payload);
        message.success('更新成功');
      } else {
        await createMcpServer(payload as McpServerConfig);
        message.success('创建成功');
      }
      setModalOpen(false);
      reload();
    } catch {
      // 表单校验失败，不处理
    }
  };

  /**
   * 切换启用状态
   */
  const handleToggle = async (server: McpServerConfig, active: boolean) => {
    const updated = await toggleMcpServerActive(server.name, active);
    if (updated) {
      setServers((prev) =>
        prev.map((s) => (s.name === server.name ? updated : s)),
      );
      message.success(`${server.name} 已${active ? '启用' : '停用'}`);
    }
  };

  /**
   * 删除服务器
   */
  const handleDelete = async (name: string) => {
    await deleteMcpServer(name);
    message.success('删除成功');
    reload();
  };

  // 统计已启用数量
  const enabledCount = servers.filter((s) => s.active === 1).length;

  return (
    <PageContainer
      header={{
        title: 'MCP',
        subTitle: `远程 MCP 服务器管理（已启用 ${enabledCount}/${servers.length}）`,
        extra: [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
          >
            新增服务器
          </Button>,
        ],
      }}
    >
      {servers.length === 0 ? (
        <Empty
          description="暂无 MCP 服务器，点击右上角「新增服务器」添加"
          style={{ marginTop: 80 }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {servers.map((server) => (
            <Col xs={24} sm={12} md={8} lg={6} key={server.name}>
              <Card
                hoverable
                style={{
                  height: '100%',
                  opacity: server.active === 1 ? 1 : 0.7,
                }}
                styles={{ body: { paddingBottom: 16 } }}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {/* 名称 + 启用开关 + 操作按钮 */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Space>
                      <span
                        style={{
                          fontSize: 22,
                          color: server.active === 1 ? '#1677ff' : '#bfbfbf',
                        }}
                      >
                        <ApiOutlined />
                      </span>
                      <Title level={5} style={{ margin: 0 }}>
                        {server.name}
                      </Title>
                      <Tag color={server.active === 1 ? 'green' : 'default'}>
                        {server.active === 1 ? '已启用' : '已停用'}
                      </Tag>
                    </Space>
                    <Switch
                      checked={server.active === 1}
                      onChange={(checked) => handleToggle(server, checked)}
                    />
                  </div>

                  {/* URL */}
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      URL
                    </Text>
                    <Paragraph
                      copyable
                      style={{
                        margin: 0,
                        fontSize: 13,
                        wordBreak: 'break-all',
                      }}
                    >
                      {server.url}
                    </Paragraph>
                  </div>

                  {/* Headers 预览 */}
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Headers
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      {server.headers &&
                      Object.keys(server.headers).length > 0 ? (
                        <Space size={[4, 4]} wrap>
                          {Object.entries(server.headers).map(([k, v]) => (
                            <Tooltip key={k} title={`${k}: ${v}`}>
                              <Tag
                                style={{
                                  margin: 0,
                                  maxWidth: 180,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {k}
                              </Tag>
                            </Tooltip>
                          ))}
                        </Space>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          无
                        </Text>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮：编辑 / 删除 */}
                  <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openEdit(server)}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确认删除该 MCP 服务器？"
                      description="删除后不可恢复"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => handleDelete(server.name)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 新增 / 编辑弹窗 */}
      <Modal
        title={editingServer ? '编辑 MCP 服务器' : '新增 MCP 服务器'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入服务器名称' },
              {
                pattern: /^[a-zA-Z0-9_-]+$/,
                message: '名称只能包含字母、数字、下划线和短横线',
              },
            ]}
          >
            <Input placeholder="例如：github" disabled={!!editingServer} />
          </Form.Item>

          <Form.Item
            name="url"
            label="URL"
            extra="远程 MCP 服务器的 Streamable HTTP 端点地址"
            rules={[
              { required: true, message: '请输入 MCP 服务器 URL' },
              {
                type: 'url',
                message: '请输入合法的 URL（需包含 http:// 或 https://）',
              },
            ]}
          >
            <Input placeholder="https://api.githubcopilot.com/mcp" />
          </Form.Item>

          <Form.Item
            name="headers"
            label="Headers（JSON）"
            extra="HTTP 请求头，最常见是鉴权用的 Authorization: Bearer <token>"
            rules={[{ required: true, message: '请输入 headers JSON' }]}
          >
            <Input.TextArea
              rows={5}
              placeholder={'{\n  "Authorization": "Bearer ghp_xxxxxxxxxxxx"\n}'}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>

          <Form.Item name="active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default McpPage;
