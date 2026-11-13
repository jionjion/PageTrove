import { Alert, Button } from 'antd';
import { ChatSourceList } from '@/components/ChatSourceList';
import { PendingContextTray } from '@/components/PendingContextTray';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { StreamingBubble } from '@/components/chat/StreamingBubble';
import { ToolActivityList } from '@/components/chat/ToolActivityList';
import { ToolApprovalCard } from '@/components/chat/ToolApprovalCard';
import { useChatController } from '@/hooks/useChatController';
import { modelCapabilityKey } from '@/types/settings';

import type { ChatCommand } from '@/hooks/useChatController';

interface Props {
  command?: ChatCommand;
  /** nonce 变化时执行 command。 */
  nonce: number;
  /** 会话上下文标题变化时通知父组件（显示在 App 头部）。 */
  onTitleChange: (title: string) => void;
}

/** 聊天视图:状态与动作全部来自 useChatController,此处只负责组合渲染。 */
export function ChatView({ command, nonce, onTitleChange }: Props) {
  const {
    session,
    activeScope,
    legacyRefs,
    scopeNotice,
    error,
    input,
    picked,
    attachment,
    draftQuote,
    picking,
    capturing,
    busy,
    streaming,
    streamingRefs,
    toolActivities,
    pendingApproval,
    chatSettings,
    modelOptions,
    capabilities,
    copiedIndex,
    ratings,
    canRefreshPage,
    refreshPagePending,
    messagesRef,
    handleMessagesScroll,
    awayFromBottom,
    resumeLatest,
    setInput,
    setError,
    setScopeNotice,
    setPicked,
    setAttachment,
    setDraftQuote,
    handleSend,
    handleStop,
    handleRegenerate,
    handleRetryInterruptedTurn,
    handlePick,
    handleCapture,
    handleCopy,
    handleRate,
    handleModelChange,
    toggleRefreshPage,
    settleToolApproval,
  } = useChatController({ command, nonce, onTitleChange });
  const verbose = chatSettings?.mcpVerboseLog ?? true;
  const messageToolExecutionIds = new Set(
    (session?.messages ?? []).flatMap(
      (message) => message.toolCalls?.map((call) => call.id) ?? [],
    ),
  );
  const lastMessage = session?.messages.at(-1);
  // 进行中的轮次，assistant 消息尚未落盘，其工具执行尚未被任何 message.toolCalls 认领；
  // 此时它们不应被误判为上一轮遗留的 orphan，否则会在每次调用工具时弹出错误告警。
  const inProgressTurnId =
    busy && lastMessage?.role === 'user' ? lastMessage.id : undefined;
  const orphanToolExecutions = (session?.toolExecutions ?? []).filter(
    (execution) =>
      !messageToolExecutionIds.has(execution.id) && execution.turnId !== inProgressTurnId,
  );
  const retryableTurnId =
    lastMessage?.role === 'user' &&
    lastMessage.id &&
    orphanToolExecutions.some((execution) => execution.turnId === lastMessage.id)
      ? lastMessage.id
      : undefined;

  return (
    <div className="chat-session">
      <div ref={messagesRef} className="chat-messages" onScroll={handleMessagesScroll}>
        {(session?.messages ?? []).map((message, index) => (
          <ChatMessageItem
            key={message.id ?? index}
            message={message}
            index={index}
            verbose={verbose}
            refs={message.citationRefs ?? legacyRefs}
            copied={copiedIndex === index}
            rating={ratings[index]}
            busy={busy}
            onCopy={(content, messageIndex) => void handleCopy(content, messageIndex)}
            onRate={handleRate}
            onRegenerate={(messageIndex) => void handleRegenerate(messageIndex)}
          />
        ))}
        {orphanToolExecutions.length > 0 && (
          <div className="tool-execution-journal">
            <Alert
              type="warning"
              showIcon
              title="上一轮工具执行未生成最终回答；重试前请先检查外部系统"
              action={
                retryableTurnId ? (
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => void handleRetryInterruptedTurn(retryableTurnId)}
                  >
                    继续生成
                  </Button>
                ) : undefined
              }
            />
            <ToolActivityList calls={orphanToolExecutions} verbose={verbose} />
          </div>
        )}
        <StreamingBubble
          streaming={streaming}
          refs={streamingRefs}
          toolActivities={toolActivities}
          verbose={verbose}
        />
        {(session?.messages.length ?? 0) === 0 && streaming === undefined && (
          <div className="empty-state empty-state-interactive">
            <ChatEmptyState hasScope={Boolean(activeScope)} onPreset={setInput} />
          </div>
        )}
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(undefined) }}
          style={{ marginBottom: 8 }}
        />
      )}

      {scopeNotice && (
        <Alert
          type="warning"
          showIcon
          title={scopeNotice}
          closable={{ onClose: () => setScopeNotice(undefined) }}
          style={{ marginBottom: 8 }}
        />
      )}

      {draftQuote || picked || attachment ? (
        <PendingContextTray
          quote={draftQuote?.text}
          pickedText={picked}
          image={attachment}
          onRemoveQuote={() => setDraftQuote(undefined)}
          onRemovePicked={() => setPicked(undefined)}
          onRemoveImage={() => setAttachment(undefined)}
        />
      ) : null}

      {activeScope && <ChatSourceList scope={activeScope} />}

      {pendingApproval && (
        <ToolApprovalCard
          key={pendingApproval.requestId}
          request={pendingApproval}
          onDeny={() => settleToolApproval(pendingApproval.requestId, { kind: 'deny' })}
          onApprove={() =>
            settleToolApproval(pendingApproval.requestId, {
              kind: 'approve-once',
            })
          }
        />
      )}

      <ChatComposer
        input={input}
        busy={busy}
        picking={picking}
        capturing={capturing}
        visionEnabled={capabilities.vision}
        model={
          chatSettings?.model
            ? modelCapabilityKey(chatSettings.provider, chatSettings.model)
            : undefined
        }
        modelOptions={modelOptions}
        awayFromBottom={awayFromBottom}
        canRefreshPage={canRefreshPage}
        refreshPagePending={refreshPagePending}
        onInputChange={setInput}
        onSend={() => void handleSend()}
        onStop={handleStop}
        onPick={() => void handlePick()}
        onCapture={() => void handleCapture()}
        onModelChange={handleModelChange}
        onScrollToBottom={() => resumeLatest()}
        onToggleRefreshPage={toggleRefreshPage}
      />
    </div>
  );
}
