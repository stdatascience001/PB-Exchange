import React, { useEffect, useRef, useState } from 'react';

interface MistakeActionModalProps {
  // Slip the Mistake button was pressed on; null keeps the modal closed.
  txId: number | null;
  onCancel: () => void;
  // Called when the mistake text is OK'd, with the trimmed text.
  onConfirm: (txId: number, mistakeRemark: string) => void;
}

type Step = 'confirm' | 'text';

// Trans-Audit's Mistake confirmation, as an in-page modal in place of the browser's
// confirm/prompt dialogs. Two steps:
//   1. "Mistake Action : Are you sure!"          OK / Cancel
//   2. "What is Mistake? Explain here."   [text]  OK saves / Cancel
// (The live page's third "Are you really sure!" confirm is intentionally left out — OK on
// the text step saves straight away.) Cancel (or Esc) at any step closes it and nothing is
// saved; OK with empty text is ignored.
export const MistakeActionModal: React.FC<MistakeActionModalProps> = ({ txId, onCancel, onConfirm }) => {
  const [step, setStep] = useState<Step>('confirm');
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  // Every new Mistake click starts again from step 1 with an empty text box.
  useEffect(() => {
    if (txId !== null) {
      setStep('confirm');
      setText('');
    }
  }, [txId]);

  // Focus follows the step: the text box on step 2, otherwise the OK button, so Enter
  // answers OK just as it did with the browser dialogs.
  useEffect(() => {
    if (txId === null) return;
    if (step === 'text') inputRef.current?.focus();
    else okRef.current?.focus();
  }, [txId, step]);

  if (txId === null) return null;

  const handleOk = () => {
    if (step === 'confirm') {
      setStep('text');
    } else {
      if (!text.trim()) return;
      onConfirm(txId, text.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const message = step === 'confirm' ? 'Mistake Action : Are you sure!' : 'What is Mistake? Explain here.';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 pt-10 z-50 animate-in fade-in duration-150"
      onKeyDown={handleKeyDown}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleOk();
        }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-300"
      >
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-base font-bold text-slate-900 mb-2">Mistake Action</h2>
          <p className="text-sm text-slate-700">{message}</p>
          {step === 'text' && (
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              className="mt-3 w-full px-3 py-2 border-2 border-[#1662c6] rounded-md text-sm text-slate-900 focus:outline-none"
            />
          )}
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button
            ref={okRef}
            type="submit"
            disabled={step === 'text' && !text.trim()}
            className="px-6 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-sm rounded-full shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            OK
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-1.5 bg-[#dbe6fb] hover:bg-[#c9d8f7] text-[#1f3f7a] font-bold text-sm rounded-full transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
