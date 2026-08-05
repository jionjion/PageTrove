import { Alert } from 'antd';
import { ChatSourceList } from '@/components/ChatSourceList';
import { PendingContextTray } from '@/components/PendingContextTray';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { StreamingBubble } from '@/components/chat/StreamingBubble';
import { useChatController } from '@/hooks/useChatController';

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
    chatSettings,
    modelOptions,
    capabilities,
    copiedIndex,
    ratings,
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
    handlePick,
    handleCapture,
    handleCopy,
    handleRate,
    handleModelChange,
  } = useChatController({ command, nonce, onTitleChange });
  const verbose = chatSettings?.mcpVerboseLog ?? true;

  return (
    <div className="chat-session">
      <div
        ref={messagesRef}
        className="chat-messages"
        onScroll={handleMessagesScroll}
      >
        {(session?.messages ?? []).map((message, index) => (
          <ChatMessageItem
            key={index}
            message={message}
            index={index}
            verbose={verbose}
            refs={message.citationRefs ?? legacyRefs}
            copied={copiedIndex === index}
            rating={ratings[index]}
            busy={busy}
            onCopy={(content, messageIndex) =>
              void handleCopy(content, messageIndex)
            }
            onRate={handleRate}
            onRegenerate={(messageIndex) => void handleRegenerate(messageIndex)}
          />
        ))}
        <StreamingBubble
          streaming={streaming}
          refs={streamingRefs}
          toolActivities={toolActivities}
          verbose={verbose}
        />
        {(session?.messages.length ?? 0) === 0 && streaming === undefined && (
          <ChatEmptyState hasScope={Boolean(activeScope)} onPreset={setInput} />
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

      <ChatComposer
        input={input}
        busy={busy}
        picking={picking}
        capturing={capturing}
        visionEnabled={capabilities.vision}
        model={chatSettings?.model}
        modelOptions={modelOptions}
        awayFromBottom={awayFromBottom}
        onInputChange={setInput}
        onSend={() => void handleSend()}
        onStop={handleStop}
        onPick={() => void handlePick()}
        onCapture={() => void handleCapture()}
        onModelChange={handleModelChange}
        onScrollToBottom={() => resumeLatest()}
      />
    </div>
  );
}
