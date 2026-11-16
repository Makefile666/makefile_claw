// src/pages/chatbot/style.ts
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  layout: css`
    display: flex;
    flex: 1;
    overflow: hidden;
  `,

  sidebar: css`
    width: 260px;
    background: ${token.colorBgContainer};
    border-right: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* 禁止选中会话名称文字，切换会话时不会出现高亮选区 */
    user-select: none;

    /* 隐藏 Conversations 内部滚动条，避免抖动 */
    .ant-conversations,
    .ant-conversations-list {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .ant-conversations::-webkit-scrollbar,
    .ant-conversations-list::-webkit-scrollbar {
      display: none;
    }
  `,

  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: ${token.colorBgContainer};
  `,

  // 三栏之间的拖拽条：4px 宽，hover 时高亮，鼠标变为水平调整大小
  resizer: css`
    width: 4px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    position: relative;
    transition: background 0.15s;

    &:hover,
    &:active {
      background: ${token.colorPrimaryBorder};
    }

    /* 拖动时隐藏文本选中，避免拖动过程中选中页面文字 */
    user-select: none;
  `,

  folderPane: css`
    width: 320px;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    overflow: hidden;

    /* Folder 组件内部的目录树滚动条隐藏，保持视觉简洁 */
    .ant-folder,
    .ant-folder-directory-tree {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .ant-folder::-webkit-scrollbar,
    .ant-folder-directory-tree::-webkit-scrollbar {
      display: none;
    }

    /* 代码预览区：highlight.js 代码块样式优化 */
    .ant-folder-preview {
      pre {
        margin: 0;
      }
      .hljs {
        background: transparent;
        padding: 0;
      }
    }
  `,

  folderHeader: css`
    padding: 12px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;

    .folder-title {
      font-size: 14px;
      font-weight: 600;
      color: ${token.colorText};
    }

    .folder-path {
      font-size: 11px;
      color: ${token.colorTextTertiary};
      margin-top: 2px;
      word-break: break-all;
    }
  `,

  folderBody: css`
    flex: 1;
    overflow: hidden;
  `,

  messages: css`
    flex: 1;
    overflow-y: auto;
    padding: ${token.paddingMD}px;
    display: flex;
    flex-direction: column;
    align-items: center;

    > * {
      width: 100%;
    }

    /* 隐藏滚动条，消除滚动条出现/消失导致的页面抖动 */
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE / Edge */

    &::-webkit-scrollbar {
      display: none; /* Chrome / Safari */
    }
  `,

  footer: css`
    padding: ${token.paddingMD}px;
    border-top: 1px solid ${token.colorBorderSecondary};
    display: flex;
    justify-content: center;
  `,

  footerCenter: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: ${token.paddingLG}px;
    gap: 32px;
    margin-top: -10%;
  `,

  welcomeTitle: css`
    font-size: 32px;
    font-weight: 600;
    color: ${token.colorText};
    text-align: center;
  `,

  cursor: css`
    animation: chatbot-blink 0.8s step-end infinite;

    @keyframes chatbot-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `,
}));
