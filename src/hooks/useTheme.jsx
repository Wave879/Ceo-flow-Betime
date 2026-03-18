import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
    // Default to light mode, check localStorage for saved preference
    const [theme, setTheme] = useState(() => {
        try {
            const savedTheme = localStorage.getItem('tf_theme');
            if (savedTheme === 'dark' || savedTheme === 'light') {
                return savedTheme;
            }
        } catch { }
        return 'light'; // Always start with light mode
    });

    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('tf_theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
