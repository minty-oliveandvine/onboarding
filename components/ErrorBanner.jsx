'use client';

export default function ErrorBanner({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="flash-message" role="alert">
      <span>{message}</span>
      <button
        type="button"
        className="flash-close"
        aria-label="Close"
        onClick={onClose}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  );
}
