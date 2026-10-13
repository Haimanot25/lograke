import { memo } from 'react';
import { Moon, Sun } from 'lucide-react';

const THEMES = [
  { id: 'black', label: 'Black', icon: Moon },
  { id: 'white', label: 'White', icon: Sun },
];

function ThemeSwitcher({ theme, onThemeChange }) {
  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Theme selection">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={theme === id}
          aria-label={label}
          title={label}
          className={`theme-btn ${theme === id ? 'active' : ''}`}
          onClick={() => onThemeChange(id)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

export default memo(ThemeSwitcher);
