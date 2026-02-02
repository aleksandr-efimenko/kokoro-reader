import { useState, useEffect, useRef } from 'react';
import { useAI } from '../hooks/useAI';
import './ClarifyPopover.css';

interface ClarifyPopoverProps {
    text: string;
    context: string;
    rect: DOMRect;
    onClose: () => void;
}

export function ClarifyPopover({ text, context, rect, onClose }: ClarifyPopoverProps) {
    const { isConnected, clarify, isThinking } = useAI();
    const [explanation, setExplanation] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Calculate position with fallback for invalid rects
    const getPosition = (): React.CSSProperties => {
        // Check if rect has valid coordinates (not 0,0 which indicates calculation failure)
        const hasValidRect = rect && (rect.top !== 0 || rect.left !== 0 || rect.width !== 0);

        if (hasValidRect) {
            return {
                position: 'fixed',
                top: Math.min(rect.bottom + 10, window.innerHeight - 200),
                left: Math.max(20, Math.min(rect.left + (rect.width / 2) - 150, window.innerWidth - 320)),
                zIndex: 10000,
            };
        }

        // Fallback: center in viewport
        return {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10000,
        };
    };

    const style = getPosition();

    // Auto-fetch if already open (e.g. if we want to change behavior later)
    // For now, we wait for click.

    const handleClarify = async () => {
        setIsOpen(true);
        setError(null);
        setExplanation(null);

        if (!isConnected) {
            return;
        }

        try {
            const result = await clarify(text, context);
            setExplanation(result);
        } catch (err) {
            setError(String(err));
        }
    };

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    if (!isOpen) {
        return (
            <div className="clarify-trigger" style={style} onClick={handleClarify}>
                ✨ Clarify
            </div>
        );
    }

    return (
        <div className="clarify-popover" style={style} ref={popoverRef}>
            {!isConnected ? (
                <div className="clarify-content">
                    <p>Please connect to Text Clarifier in Settings to use this feature.</p>
                </div>
            ) : isThinking ? (
                <div className="clarify-loading">
                    <div className="spinner"></div>
                    <span>Thinking...</span>
                </div>
            ) : error ? (
                <div className="clarify-error">
                    <strong>Error:</strong> {error}
                </div>
            ) : (
                <div className="clarify-content">
                    <div className="clarify-header">
                        <span className="clarify-term">"{text}"</span>
                        <button className="clarify-close" onClick={onClose}>✕</button>
                    </div>
                    <div className="clarify-body">
                        {explanation}
                    </div>
                </div>
            )}
        </div>
    );
}
