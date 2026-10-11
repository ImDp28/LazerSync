import { createContext, useContext, useState } from "react";
const AuthContext = createContext(undefined);
export const AuthProvider = ({ children }) => {
    // 🔥 MAGIC HERE: Synchronously reading from localStorage at initial render
    const [token, setToken] = useState(() => {
        return localStorage.getItem('token');
    });
    const [user, setUser] = useState(() => {
        const storedUser = localStorage.getItem('user');
        return storedUser && storedUser !== 'undefined' ? JSON.parse(storedUser) : null;
    });
    // Ab loading ki zaroorat nahi hai kyunki data instantly pehle render mein hi aa gaya
    const [loading, setLoading] = useState(false);
    const login = (userData, userToken) => {
        setUser(userData);
        setToken(userToken);
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('token', userToken);
    };
    const logout = () => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
    };
    return (<AuthContext.Provider value={{
            user,
            token,
            login,
            logout,
            isAuthenticated: !!token,
            loading
        }}>
            {children}
        </AuthContext.Provider>);
};
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context)
        throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
