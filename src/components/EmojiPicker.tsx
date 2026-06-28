import React from "react";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EMOJI_CATEGORIES = {
  "Smileys": ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😭", "😤", "😡"],
  "Gestures & Hands": ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "✋", "👋", "👏", "🙌", "🙏", "💪", "✍️"],
  "Hearts & Love": ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘"],
  "Fun & Sports": ["🎉", "🔥", "✨", "🌟", "🎈", "🎂", "🎄", "📱", "💻", "⚽", "🏀", "🎮", "🎵", "📷", "💡", "🚀", "🍕", "🍺", "☕", "🍿"]
};

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [currentCategory, setCurrentCategory] = React.useState<keyof typeof EMOJI_CATEGORIES>("Smileys");

  return (
    <div className="absolute bottom-16 left-2 z-50 w-72 rounded-xl bg-[#161616] shadow-2xl border border-white/5 overflow-hidden flex flex-col max-h-80 select-none animate-in fade-in slide-in-from-bottom-4 duration-150">
      {/* Category Toggles */}
      <div className="flex border-b border-white/5 bg-[#1C1C1C] p-1.5 overflow-x-auto gap-1">
        {Object.keys(EMOJI_CATEGORIES).map((cat) => (
          <button
            key={cat}
            id={`emoji-cat-${cat.replace(/\s+/g, "-")}`}
            type="button"
            className={`px-3 py-1 text-xs font-semibold rounded-lg shrink-0 transition-colors ${
              currentCategory === cat
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-white/5"
            }`}
            onClick={() => setCurrentCategory(cat as keyof typeof EMOJI_CATEGORIES)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid of Emojis */}
      <div className="p-3 bg-[#111111] overflow-y-auto grid grid-cols-6 gap-2 max-h-56">
        {EMOJI_CATEGORIES[currentCategory].map((emoji, idx) => (
          <button
            key={idx}
            id={`emoji-btn-${idx}`}
            type="button"
            className="text-2xl hover:scale-125 hover:bg-white/5 p-1.5 rounded-lg transition-all focus:outline-none flex items-center justify-center cursor-pointer"
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Footer / Info */}
      <div className="p-2 bg-[#1C1C1C] border-t border-white/5 flex justify-between items-center text-xs text-slate-400">
        <span>Click to insert</span>
        <button
          id="close-emoji-panel"
          type="button"
          onClick={onClose}
          className="hover:text-white font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}
