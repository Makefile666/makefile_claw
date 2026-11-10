import { UserOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Bubble, Conversations, Sender, Think, XProvider } from '@ant-design/x';
import type {
  BubbleItemType,
  BubbleListProps,
} from '@ant-design/x/es/bubble/interface';
import XMarkdown from '@ant-design/x-markdown';
import { useXChat } from '@ant-design/x-sdk';
import { Avatar, Card, Select, Space, Tag, Typography } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ConversationItem, ParsedMessage } from './data';
import {
  createChatProvider,
  fetchSessions,
  fetchSessionMessages,
  deleteSession,
  generateTitle,
  renameSession,
  type HistoryMessage,
} from './service';
import { listAgents, listSkills } from '../agents/service';
import type { AgentConfig, SkillConfig } from '../agents/types';
import { useStyles } from './style';

// 欢迎语，首页打字机效果文案
const WELCOME_TEXT = '🤖 你好，有什么可以帮你？';

/**
 * 格式化会话标签：显示最后活跃时间
 */
const formatSessionLabel = (iso: string): string => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (isToday) return `今天 ${time}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  } catch {
    return '历史对话';
  }
};

/**
 * 格式化会话分组：今天 / 昨天 / 实际日期
 * 早于昨天的会话显示具体日期（同年显示 MM-DD，跨年显示 YYYY-MM-DD）
 */
const formatSessionGroup = (iso: string): string => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return '今天';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return '昨天';
    // 更早的会话显示实际日期
    const sameYear = d.getFullYear() === now.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return sameYear ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
  } catch {
    return '历史对话';
  }
};

/**
 * 打字机欢迎标题组件
 * 页面无对话时展示，逐字输出欢迎文本，附带光标
 */
const TypewriterTitle: React.FC = () => {
  const { styles } = useStyles();
  const [index, setIndex] = useState(0);
  const done = index >= WELCOME_TEXT.length;

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= WELCOME_TEXT.length) {
          clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {WELCOME_TEXT.slice(0, index)}
      {!done && <span className={styles.cursor}>|</span>}
    </>
  );
};

/**
 * 消息解析器 parser
 * useXChat 的 parser 钩子：每收到一条 AI 分片消息时执行
 * 核心职责：拆分 思考标签 和 正式回答内容
 *
 * 支持多步骤 Agent 执行：同一条消息中可能包含多个 <think>...</think> 块
 * （每个步骤一段思考），解析器会提取所有思考块合并为 thinkContent，
 * 并从正文中移除这些思考块，剩余的正文（含工具调用/结果 markdown）交由 XMarkdown 渲染。
 *
 * @param message SDK 返回原始消息对象
 * @returns ParsedMessage 拆分后的结构，区分 thinkContent / content
 */
const parser = (message: { content: string; role: string }): ParsedMessage => {
  const { content, role } = message;
  // 用户消息不需要解析思考块，直接原样返回
  if (role !== 'assistant') return { role: 'user', content };

  const thinkBlocks: string[] = [];
  let body = content;

  // 提取所有已闭合的 <think>...</think> 块，并从正文中移除
  body = body.replace(/<think>([\s\S]*?)<\/think>/g, (_, think: string) => {
    thinkBlocks.push(think);
    return '';
  });

  // 处理流式输出中最后一个未闭合的 <think> 块（正在输出思考过程）
  const partialMatch = body.match(/<think>([\s\S]*)$/);
  if (partialMatch) {
    thinkBlocks.push(partialMatch[1]);
    body = body.slice(0, partialMatch.index);
  }

  const thinkContent = thinkBlocks.join('\n');
  body = body.trimStart();

  if (thinkContent) {
    return { role: 'assistant', thinkContent, content: body };
  }
  // 不存在思考标签，直接返回正文
  return { role: 'assistant', content: body };
};

// 流式渲染配置：正在持续接收分片，开启逐字动画
const STREAMING_ACTIVE = { hasNextChunk: true, enableAnimation: true };
// 流结束：没有后续分片
const STREAMING_IDLE = { hasNextChunk: false, enableAnimation: true };

/**
 * 气泡角色配置
 * 控制 user / ai 气泡的头像、位置、渲染逻辑
 * ai.contentRender：自定义渲染函数，使用 XMarkdown 渲染markdown，绑定流式打字动画
 */
const roleConfig: BubbleListProps['role'] = {
  user: {
    placement: 'end',
    avatar: <Avatar icon={<UserOutlined />} />,
  },
  ai: {
    placement: 'start',
    avatar: (
      <Avatar
        style={{
          background: 'transparent',
          fontSize: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🤖
      </Avatar>
    ),
    typing: { effect: 'typing', step: 2, interval: 20 },
    contentRender: (
      content: string,
      info: { status?: string; loading?: boolean },
    ) => {
      if (info?.loading || !content) return undefined;
      return (
        <XMarkdown
          streaming={
            info?.status === 'updating' ? STREAMING_ACTIVE : STREAMING_IDLE
          }
        >
          {content}
        </XMarkdown>
      );
    },
  },
};

const ChatbotPage: React.FC = () => {
  const { styles } = useStyles();

  // 进入聊天页时锁定页面级滚动，避免页面出现滚动条导致抖动；
  // 仅消息列表区域内部可滚动（滚动条已隐藏），离开页面时恢复
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // 对话ID生成器
  const idCounter = useRef(0);
  const generateId = useCallback(() => `conv-${++idCounter.current}`, []);

  // 会话列表：左侧会话栏，包含历史会话 + 新建对话
  const [conversations, setConversations] = useState<ConversationItem[]>([
    // 默认显示一个新对话
    { key: 'default', label: '💬 新对话', group: '今天', isDraft: true },
  ]);
  // 当前激活的会话key，多会话隔离消息
  const [activeKey, setActiveKey] = useState<string>('default');
  // 输入框绑定值
  const [inputValue, setInputValue] = useState('');
  // 历史会话加载中标记
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // 已安装技能列表（用于技能选择器）
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  // 当前选中的技能名称数组
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  // selectedSkills 的 ref，供 getSkills 回调实时读取最新值（避免闭包过期）
  const selectedSkillsRef = useRef<string[]>([]);
  useEffect(() => {
    selectedSkillsRef.current = selectedSkills;
  }, [selectedSkills]);

  // 可用 Agent 列表（用于 Agent 选择器）
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  // 当前选中的 Agent 名称（单选，为空时后端使用默认 TestAgent）
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  // selectedAgent 的 ref，供 getAgent 回调实时读取最新值（避免闭包过期）
  const selectedAgentRef = useRef<string>('');
  useEffect(() => {
    selectedAgentRef.current = selectedAgent;
  }, [selectedAgent]);

  // 页面挂载时加载已安装技能列表和 Agent 列表，填充选择器
  useEffect(() => {
    listSkills()
      .then((list) => setSkills(list))
      .catch((e) => console.error('[chatbot] load skills failed:', e));
    listAgents()
      .then((list) => {
        setAgents(list);
        // 默认选中第一个可用 Agent
        if (list.length > 0 && !selectedAgent) {
          setSelectedAgent(list[0].name);
        }
      })
      .catch((e) => console.error('[chatbot] load agents failed:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 会话ID映射表：前端对话key -> 后端 threadId（即 sessionId）
  // 用 ref 存储避免闭包过期，onSessionId 回调中实时写入
  const threadIdMapRef = useRef<Record<string, string>>({});
  // 历史消息缓存：threadId -> 消息数组，切换回已加载过的会话时直接命中，无需再次请求
  const messageCacheRef = useRef<Record<string, any[]>>({});
  // 当前激活会话key的ref，供 onSessionId 回调读取（避免 useMemo 闭包过期）
  const activeKeyRef = useRef(activeKey);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  // 待生成标题的会话：仅新对话（草稿）发送第一条消息后置位，
  // 响应结束后调用 generateTitle，用模型提炼的标题替换临时标签
  const pendingTitleRef = useRef<{ key: string; content: string } | null>(null);
  // 上一帧 isRequesting 的值，用于检测请求完成的下降沿
  const wasRequestingRef = useRef(false);

  /**
   * 页面挂载时从后端加载历史会话列表，填充到左侧会话栏
   * 每个会话的 key 直接使用后端 threadId，便于后续按 key 定位消息
   */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSessionsLoading(true);
      try {
        const sessions = await fetchSessions();
        if (cancelled) return;
        if (sessions.length > 0) {
          const items: ConversationItem[] = sessions.map((s) => ({
            key: s.threadId,
            // 优先使用后端返回的标题（自动生成或手动改名），为空则回退到时间标签
            label: s.title || formatSessionLabel(s.updatedAt),
            group: formatSessionGroup(s.updatedAt),
            threadId: s.threadId,
            manuallyRenamed: s.manuallyRenamed,
          }));
          // 历史会话插在“新对话”之后
          setConversations((prev) => [prev[0], ...items]);
          // 建立 key -> threadId 映射（历史会话的 key 就是 threadId）
          sessions.forEach((s) => {
            threadIdMapRef.current[s.threadId] = s.threadId;
          });
        }
      } catch (e) {
        console.error('[chatbot] load sessions failed:', e);
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 使用useMemo缓存provider实例，避免每次渲染重复new
  // onSessionId：后端在SSE分片中返回sessionId（即threadId）时触发，存入当前对话的映射表
  // getAgent：每次请求时实时返回当前选中的 Agent 名称，后端据此加载对应配置
  // getSkills：每次请求时实时返回当前选中的技能名称数组，后端据此注入技能正文到 system prompt
  const provider = useMemo(
    () =>
      createChatProvider(
        (id: string) => {
          const key = activeKeyRef.current;
          threadIdMapRef.current[key] = id;
          // 把 threadId 回写到会话项，使该会话的 label 变为可编辑状态
          setConversations((prev) =>
            prev.map((c) => (c.key === key ? { ...c, threadId: id } : c)),
          );
        },
        () => selectedAgentRef.current,
        () => selectedSkillsRef.current,
      ) as any,
    [],
  );
  /**
   * useXChat 核心钩子
   * provider：对接service里的请求逻辑
   * conversationKey：会话ID，用来做多会话消息隔离
   * defaultMessages：切换会话时异步加载该会话的历史消息，实现刷新还原
   * parser：消息分片解析函数，拆分think和正文
   * parsedMessages：parser处理完成后的消息列表（页面渲染数据源）
   * onRequest：触发发送消息
   * abort：中断SSE请求（停止生成）
   * isRequesting：是否正在请求/流式输出
   */
  const { onRequest, abort, isRequesting, parsedMessages } = useXChat<
    any,
    ParsedMessage
  >({
    provider,
    conversationKey: activeKey,
    parser,
    requestPlaceholder: { role: 'assistant', content: '' },
    // 切换到某个会话时，根据 conversationKey 从后端加载历史消息
    // 已加载过的会话直接从 messageCacheRef 命中，避免重复请求
    defaultMessages: async ({ conversationKey }: { conversationKey?: string }) => {
      const key = conversationKey ?? '';
      const threadId = threadIdMapRef.current[key];
      if (!threadId) return [];
      // 命中缓存则直接返回，无需网络请求
      if (messageCacheRef.current[threadId]) {
        return messageCacheRef.current[threadId];
      }
      try {
        const msgs: HistoryMessage[] = await fetchSessionMessages(threadId);
        const mapped = msgs.map((m, i) => ({
          id: `hist-${key}-${i}`,
          message: { role: m.role, content: m.content } as any,
          status: 'success' as const,
        }));
        // 写入缓存，下次切换回该会话直接命中
        messageCacheRef.current[threadId] = mapped;
        return mapped;
      } catch (e) {
        console.error('[chatbot] load history messages failed:', e);
        return [];
      }
    },
  });

  /**
   * 监听请求状态下降沿（isRequesting: true -> false）
   * 若存在待生成标题的会话（新对话首条消息刚结束），
   * 调用后端 generateTitle 用模型提炼标题，替换临时标签。
   * 已手动改名的会话由后端守卫，不会被覆盖。
   */
  useEffect(() => {
    if (wasRequestingRef.current && !isRequesting) {
      const pending = pendingTitleRef.current;
      if (pending) {
        pendingTitleRef.current = null;
        const threadId = threadIdMapRef.current[pending.key];
        if (threadId) {
          generateTitle(threadId, pending.content)
            .then((title) => {
              setConversations((prev) =>
                prev.map((c) =>
                  c.key === pending.key
                    ? { ...c, label: title, threadId }
                    : c,
                ),
              );
            })
            .catch((e) =>
              console.error('[chatbot] generateTitle failed:', e),
            );
        }
      }
    }
    wasRequestingRef.current = isRequesting;
  }, [isRequesting]);

  /**
   * 手动修改会话标题
   * 调用后端 PUT 接口持久化，并标记 manuallyRenamed=true，
   * 后续自动生成标题不会再覆盖。
   */
  const handleRename = useCallback(
    (key: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      const conv = conversations.find((c) => c.key === key);
      const threadId = conv?.threadId ?? threadIdMapRef.current[key];
      if (!threadId) return;
      renameSession(threadId, trimmed).catch((e) =>
        console.error('[chatbot] renameSession failed:', e),
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.key === key
            ? { ...c, label: trimmed, manuallyRenamed: true, threadId }
            : c,
        ),
      );
    },
    [conversations],
  );

  /**
   * 发送消息
   * @param content 用户输入文本
   */
  const sendMessage = (content: string) => {
    setInputValue('');
    // 如果是草稿会话（新对话首条消息），记录待生成标题的内容，
    // 等响应结束后由模型自动提炼标题；临时标签先用前 20 字占位
    const isDraft = conversations.find((c) => c.key === activeKey)?.isDraft;
    if (isDraft) {
      pendingTitleRef.current = { key: activeKey, content };
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.key === activeKey && c.isDraft
          ? { ...c, label: content.slice(0, 20) || '新对话', isDraft: false }
          : c,
      ),
    );
    // 交给useXChat发起请求
    // chatId 使用该会话对应的后端 threadId（历史会话直接用 threadId，新对话首次为空）
    const chatId = threadIdMapRef.current[activeKey] ?? '';
    // 发送新消息后该会话内容会变化，清除缓存以便下次切换时重新拉取
    if (chatId) delete messageCacheRef.current[chatId];
    onRequest({ messages: [{ role: 'user', content }], chatId });
  };

  /**
   * 新建对话
   */
  const newChat = () => {
    const key = generateId();
    setConversations((prev) => [
      { key, label: '新对话', group: '今天', isDraft: true },
      ...prev,
    ]);
    setActiveKey(key);
  };

  /**
   * 根据消息状态返回 XMarkdown 的流式配置
   * - updating：流式输出中，开启逐字动画并标记有后续分片
   * - 其他状态：流已结束
   */
  const getStreamingConfig = (status?: string) =>
    status === 'updating' ? STREAMING_ACTIVE : STREAMING_IDLE;

  /**
   * 转换气泡渲染列表
   * 把 parsedMessages 映射成 Bubble.List 需要的格式
   * 如果解析出 thinkContent，挂载到 item.header，交给 <Think> 组件渲染思考块
   * 思考内容与正文一样使用 XMarkdown 结构化渲染 + 流式动画
   */
  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      parsedMessages.map((msg) => {
        const parsed = msg.message as ParsedMessage;
        const isAI = parsed.role === 'assistant';
        const thinkContent =
          parsed.role === 'assistant' ? parsed.thinkContent : undefined;

        const item: BubbleItemType = {
          key: msg.id,
          role: isAI ? 'ai' : 'user',
          content: parsed.content,
          loading: isAI && msg.status === 'loading',
          status: msg.status,
        };

        // 有思考内容：用 XMarkdown 结构化渲染，支持流式动画，与正文保持一致
        if (isAI && thinkContent) {
          item.header = (
            <Think>
              <XMarkdown streaming={getStreamingConfig(msg.status)}>
                {thinkContent}
              </XMarkdown>
            </Think>
          );
        }

        return item;
      }),
    [parsedMessages],
  );

  // 是否存在对话消息，区分欢迎页和消息列表
  const hasMessages = parsedMessages.length > 0;

  /**
   * 把会话列表转换为 Conversations 组件所需的 items：
   * - 已有 threadId 的会话：label 渲染为可编辑文本，点击铅笔图标可手动改名
   * - 草稿会话（无 threadId）：label 渲染为纯文本，不可编辑
   * editable 的 onClick 阻止冒泡，避免触发会话切换
   */
  const conversationItems = useMemo(
    () =>
      conversations.map((c) => {
        const canEdit = !!c.threadId;
        return {
          ...c,
          label: canEdit ? (
            <Typography.Text
              editable={{
                onChange: (val: string) => handleRename(c.key, val),
                maxLength: 30,
                tooltip: '点击修改会话名称',
              }}
              style={{ width: '100%' }}
            >
              {c.label}
            </Typography.Text>
          ) : (
            c.label
          ),
        };
      }),
    [conversations, handleRename],
  );

  return (
    <PageContainer
      ghost
      childrenContentStyle={{
        paddingBlock: 0,
         height: 'calc(100vh - 160px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Card
        variant="borderless"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        styles={{
          body: {
            flex: 1,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <XProvider>
          <div className={styles.layout}>
            {/* 左侧会话列表 */}
            <div className={styles.sidebar}>
              <Conversations
                items={conversationItems}
                activeKey={activeKey}
                onActiveChange={setActiveKey}
                groupable
                menu={(conversation) => ({
                  items: [{ key: 'delete', label: '删除', danger: true }],
                  onClick: ({ key }) => {
                    if (key === 'delete') {
                      // 先调用后端删除检查点文件 + 元数据文件，确保刷新后不再还原
                      const threadId =
                        conversation.threadId ??
                        threadIdMapRef.current[conversation.key];
                      if (threadId) {
                        deleteSession(threadId).catch((e) =>
                          console.error(
                            '[chatbot] deleteSession failed:',
                            e,
                          ),
                        );
                      }
                      // 清理 ref 中的映射和消息缓存
                      delete threadIdMapRef.current[conversation.key];
                      if (threadId) delete messageCacheRef.current[threadId];
                      setConversations((prev) => {
                        const next = prev.filter(
                          (c) => c.key !== conversation.key,
                        );
                        // 删除后保证至少保留一个对话
                        if (next.length === 0) {
                          const newKey = generateId();
                          next.push({
                            key: newKey,
                            label: '💬 新对话',
                            group: '今天',
                            isDraft: true,
                          });
                          setActiveKey(newKey);
                        } else if (activeKey === conversation.key) {
                          setActiveKey(next[0]?.key ?? '');
                        }
                        return next;
                      });
                    }
                  },
                })}
                creation={{ onClick: newChat, label: '新建对话' }}
              />
            </div>

            {/* 主聊天区域 */}
            <div className={styles.main}>
              {/* Agent + Skills 选择栏：用户可选择对话使用的 Agent 和技能，
                  选中的 Agent 名称和技能列表会随每条请求透传到后端流式接口 */}
              {(agents.length > 0 || skills.length > 0) && (
                <div
                  style={{
                    padding: '8px 16px',
                    borderBottom: '1px solid #f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  {agents.length > 0 && (
                    <Space size={8} wrap>
                      <Tag color="blue">Agent</Tag>
                      <Select
                        placeholder="选择 Agent"
                        value={selectedAgent || undefined}
                        onChange={(val) => setSelectedAgent(val || '')}
                        options={agents.map((a) => ({
                          label: a.name,
                          value: a.name,
                        }))}
                        style={{ minWidth: 160 }}
                      />
                    </Space>
                  )}
                  {skills.length > 0 && (
                    <Space size={8} wrap>
                      <Tag color="gold">Skills</Tag>
                      <Select
                        mode="multiple"
                        allowClear
                        placeholder="选择技能（可多选）"
                        value={selectedSkills}
                        onChange={setSelectedSkills}
                        options={skills.map((s) => ({
                          label: s.active
                            ? s.name
                            : `${s.name}（已停用）`,
                          value: s.name,
                          disabled: !s.active,
                        }))}
                        style={{ minWidth: 240 }}
                        maxTagCount="responsive"
                      />
                    </Space>
                  )}
                  {(selectedAgent || selectedSkills.length > 0) && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {selectedAgent && `Agent: ${selectedAgent}`}
                      {selectedAgent && selectedSkills.length > 0 && ' · '}
                      {selectedSkills.length > 0 && `Skills: ${selectedSkills.length} 个`}
                    </Typography.Text>
                  )}
                </div>
              )}

              {hasMessages && (
                <div className={styles.messages}>
                  <Bubble.List
                    items={bubbleItems}
                    role={roleConfig}
                    autoScroll
                    styles={{ root: { maxWidth: 940 } }}
                  />
                </div>
              )}

              {/* 底部输入区：无消息居中展示欢迎语 */}
              <div
                className={hasMessages ? styles.footer : styles.footerCenter}
              >
                {!hasMessages && (
                  <div className={styles.welcomeTitle}>
                    <TypewriterTitle />
                  </div>
                )}
                <Sender
                  value={inputValue}
                  onChange={setInputValue}
                  loading={isRequesting}
                  onSubmit={sendMessage}
                  onCancel={abort}
                  placeholder="输入消息，按 Enter 发送..."
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  style={{ maxWidth: 940, width: '100%' }}
                  styles={{ input: { paddingBlock: 0 } }}
                />
              </div>
            </div>
          </div>
        </XProvider>
      </Card>
    </PageContainer>
  );
};

export default ChatbotPage;
