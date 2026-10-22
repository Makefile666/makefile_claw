import {
  CloudServerOutlined,
  CodeOutlined,
  FileTextOutlined,
  FundOutlined,
  GlobalOutlined,
  SearchOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card,
  Col,
  Row,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

import { getMakefileClawToolsConfig, updateTool } from './service';
import type { ToolConfig } from './types';

const { Title, Text, Paragraph } = Typography;

const CATEGORY_COLORS: Record<string, string> = {
  search: 'blue',
  exec: 'orange',
  file: 'green',
  network: 'purple',
};

const CATEGORY_LABELS: Record<string, string> = {
  search: '搜索',
  exec: '执行',
  file: '文件',
  network: '网络',
};

const ICON_MAP: Record<string, React.ReactNode> = {
  web_search: <SearchOutlined />,
  code_executor: <CodeOutlined />,
  file_operations: <FileTextOutlined />,
  shell_command: <ToolOutlined />,
  http_request: <GlobalOutlined />,
  knowledge_base: <CloudServerOutlined />,
};

// const ToolsPage: React.FC = () => {
//   const [tools, setTools] = useState<ToolConfig[]>([]);

//   const reload = async () => {
//     setTools(await listTools());
//   };

//   useEffect(() => {
//     reload();
//   }, []);

//   const handleToggle = async (tool: ToolConfig, enabled: boolean) => {
//     const updated = await toggleTool(tool.id, enabled);
//     if (updated) {
//       setTools((prev) => prev.map((t) => (t.id === tool.id ? updated : t)));
//       message.success(`${tool.name} 已${enabled ? '开启' : '关闭'}`);
//     }
//   };

//   const builtinTools = useMemo(() => tools.filter((t) => t.builtin), [tools]);
//   const enabledCount = builtinTools.filter((t) => t.enabled).length;

//   return (
//     <PageContainer
//       header={{
//         title: 'Tools',
//         subTitle: `内置工具管理（已开启 ${enabledCount}/${builtinTools.length}）`,
//         extra: [],
//       }}
//     >
//       <Row gutter={[16, 16]}>
//         {builtinTools.map((tool) => (
//           <Col xs={24} sm={12} md={8} lg={6} key={tool.id}>
//             <Card
//               hoverable
//               style={{
//                 height: '100%',
//                 opacity: tool.enabled ? 1 : 0.7,
//               }}
//               styles={{ body: { paddingBottom: 16 } }}
//             >
//               <Space direction="vertical" size={12} style={{ width: '100%' }}>
//                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
//                   <Space>
//                     <span style={{ fontSize: 24, color: tool.enabled ? '#1677ff' : '#bfbfbf' }}>
//                       {ICON_MAP[tool.id] ?? <FundOutlined />}
//                     </span>
//                     <Title level={5} style={{ margin: 0 }}>{tool.name}</Title>
//                   </Space>
//                   <Switch
//                     checked={tool.enabled}
//                     onChange={(checked) => handleToggle(tool, checked)}
//                   />
//                 </div>
//                 <Tag color={CATEGORY_COLORS[tool.category] || 'default'}>
//                   {CATEGORY_LABELS[tool.category] || tool.category}
//                 </Tag>
//                 <Paragraph type="secondary" style={{ margin: 0 }}>
//                   {tool.description}
//                 </Paragraph>
//                 {tool.config && Object.keys(tool.config).length > 0 && (
//                   <Space size={[4, 4]} wrap>
//                     {Object.entries(tool.config).map(([k, v]) => (
//                       <Text key={k} type="secondary" style={{ fontSize: 12 }}>
//                         <SettingOutlined /> {k}: <Text code>{String(v)}</Text>
//                       </Text>
//                     ))}
//                   </Space>
//                 )}
//               </Space>
//             </Card>
//           </Col>
//         ))}
//       </Row>
//     </PageContainer>
//   );
// };


/**
 * 内置工具管理页面
 * 功能：展示所有内置工具、查看工具分类描述与配置项，开关启用状态；
 * 工具为系统内置，不支持新增、删除、编辑，仅控制是否启用；
 * 只有在这里开启的工具，才可以在 Agents 创建页面被选择绑定
 */
const ToolsPage: React.FC = () => {
  // 全部工具列表数据源
  const [tools, setTools] = useState<ToolConfig[]>([]);

  /**
   * 一、刷新工具列表
   * 请求后端接口，拉取全部工具配置并更新状态
   */
  const reload = async () => {
    setTools(await getMakefileClawToolsConfig());
  };

  // 组件首次挂载，加载工具数据
  useEffect(() => {
    reload();
  }, []);

  /**
   * 二、切换工具启用/停用状态
   * @param tool 目标工具对象
   * @param enabled 开关布尔值 true开启 / false关闭
   */
  const handleToggle = async (tool: ToolConfig, enabled: boolean) => {
    // 调用后端接口更新启用状态，返回更新后的工具对象
    const updated = await updateTool(tool.name, { active: enabled ? 1 : 0 });
    if (updated) {
      // 局部更新state，不需要全量reload，提升体验
      setTools((prev) => prev.map((t) => (t.name === tool.name ? updated : t)));
      message.success(`${tool.name} 已${enabled ? '开启' : '关闭'}`);
    }
  };

  // 展示全部工具（包括内置 + 自定义）
  // useMemo缓存：避免每次渲染重复计算已启用数量
  const enabledCount = useMemo(
    () => tools.filter((t) => t.active === 1).length,
    [tools],
  );

  return (
    <PageContainer
      header={{
        title: 'Tools',
        subTitle: `工具管理（已开启 ${enabledCount}/${tools.length}）`,
        extra: [],
      }}
    >
      {/* 响应式卡片网格，展示所有工具 */}
      <Row gutter={[16, 16]}>
        {tools.map((tool) => (
          <Col xs={24} sm={12} md={8} lg={6} key={tool.name}>
            <Card
              hoverable
              style={{
                height: '100%',
                // 未启用工具降低透明度做视觉区分
                opacity: tool.active === 1 ? 1 : 0.7,
              }}
              styles={{ body: { paddingBottom: 16 } }}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {/* 工具图标、名称 + 启用开关 一行布局 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <span style={{ fontSize: 24, color: tool.active === 1 ? '#1677ff' : '#bfbfbf' }}>
                      {/* 按tool.name匹配图标，无匹配则使用兜底图标 */}
                      {ICON_MAP[tool.name] ?? <FundOutlined />}
                    </span>
                    <Title level={5} style={{ margin: 0 }}>{tool.name}</Title>
                    {/* 内置/自定义标识：builtin=1 显示「内置」，否则显示「自定义」 */}
                    <Tag color={tool.builtin === 1 ? 'blue' : 'orange'} style={{ marginInlineEnd: 0 }}>
                      {tool.builtin === 1 ? '内置' : '自定义'}
                    </Tag>
                  </Space>
                  {/* 启用状态开关 */}
                  <Switch
                    checked={tool.active === 1}
                    onChange={(checked) => handleToggle(tool, checked)}
                  />
                </div>
                {/* 工具分类标签，颜色与文案映射由常量配置 */}
                <Tag color={tool.category ? (CATEGORY_COLORS[tool.category] || 'default') : 'default'}>
                  {tool.category ? (CATEGORY_LABELS[tool.category] || tool.category) : '未分类'}
                </Tag>
                {/* 工具功能描述 */}
                <Paragraph type="secondary" style={{ margin: 0 }}>
                  {tool.description}
                </Paragraph>
                {/* 如果存在自定义配置项，展示配置key-value */}
                {tool.config && Object.keys(tool.config).length > 0 && (
                  <Space size={[4, 4]} wrap>
                    {Object.entries(tool.config).map(([k, v]) => (
                      <Text key={k} type="secondary" style={{ fontSize: 12 }}>
                        <SettingOutlined /> {k}: <Text code>{String(v)}</Text>
                      </Text>
                    ))}
                  </Space>
                )}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </PageContainer>
  );
};


export default ToolsPage;