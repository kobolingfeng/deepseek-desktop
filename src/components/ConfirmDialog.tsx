import { useI18n } from '../lib/i18n';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">{title}</div>
        {message && <div className="dialog-msg">{message}</div>}
        <div className="dialog-actions">
          <button className="btn-deny" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button className={danger ? 'btn-danger' : 'btn-approve'} onClick={onConfirm} autoFocus>
            {confirmLabel || t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
