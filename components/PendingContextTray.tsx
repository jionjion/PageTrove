import React from 'react';
import {
  AimOutlined,
  CloseOutlined,
  MessageOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import type { CapturedImage } from '@/services/screenshot-capture';

interface Props {
  quote?: string;
  pickedText?: string;
  image?: CapturedImage;
  onRemoveQuote?: () => void;
  onRemovePicked?: () => void;
  onRemoveImage?: () => void;
}

interface ItemProps {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  removeLabel: string;
  onRemove?: () => void;
  children: React.ReactNode;
}

function TrayItem({ icon, label, meta, removeLabel, onRemove, children }: ItemProps) {
  return (
    <div className="pending-item">
      <div className="pending-item-head">
        <span className="pending-item-label">
          {icon}
          {label}
        </span>
        {meta && <span className="pending-item-meta">{meta}</span>}
        <button
          type="button"
          className="pending-item-close"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <CloseOutlined />
        </button>
      </div>
      <div className="pending-item-body">{children}</div>
    </div>
  );
}

/** 待发送上下文托盘：统一承载右键引用、页面选取文字与截图，随下一条消息发送。 */
export function PendingContextTray({
  quote,
  pickedText,
  image,
  onRemoveQuote,
  onRemovePicked,
  onRemoveImage,
}: Props) {
  if (!quote && !pickedText && !image) return null;

  return (
    <div className="pending-tray">
      {quote && (
        <TrayItem
          icon={<MessageOutlined />}
          label="引用"
          meta={`${quote.length} 字`}
          removeLabel="移除引用"
          onRemove={onRemoveQuote}
        >
          <div className="pending-item-text">{quote}</div>
        </TrayItem>
      )}
      {pickedText && (
        <TrayItem
          icon={<AimOutlined />}
          label="页面文字"
          meta={`${pickedText.length} 字`}
          removeLabel="移除页面文字"
          onRemove={onRemovePicked}
        >
          <div className="pending-item-text">{pickedText}</div>
        </TrayItem>
      )}
      {image && (
        <TrayItem
          icon={<PictureOutlined />}
          label="截图"
          meta={`${image.width}×${image.height}`}
          removeLabel="移除截图"
          onRemove={onRemoveImage}
        >
          <img className="pending-item-image" src={image.dataUrl} alt="待发送截图" />
        </TrayItem>
      )}
    </div>
  );
}
