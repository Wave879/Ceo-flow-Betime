import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, hasFirebaseConfig } from '../firebase';
import { initialEmployees, initialPositions, initialTasks, EMPLOYEE_COLORS } from '../data/initialData';

// ── localStorage helpers ─────────────────────────────────
const LS_KEYS = { tasks: 'tf_tasks', employees: 'tf_employees', positions: 'tf_positions' };

function normalizeTask(task) {
    if (!task) return task;
    return {
        ...task,
        type: task.type === 'solo' ? 'individual' : (task.type || 'individual'),
    };
}

function loadLS(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
    } catch { }
    return fallback;
}

function saveLS(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { }
}

// ── hook ─────────────────────────────────────────────────
export function useFirestore() {
    // Force clean state (ignore old localStorage sample data)
    const [tasks, setTasks] = useState(() => initialTasks.map(normalizeTask));
    const [employees, setEmployees] = useState(() => []);
    const [positions, setPositions] = useState(() => initialPositions);
    const [projects, setProjects] = useState(() => []);
    const [loading, setLoading] = useState(true);
    // ✅ Force Firebase only (disable local mode completely)
    const [useLocal] = useState(() => !hasFirebaseConfig);
    const ready = useRef(false);

    // Persist to localStorage whenever state changes (after first load)
    useEffect(() => {
        if (!ready.current) return;
        saveLS(LS_KEYS.tasks, tasks);
    }, [tasks]);

    useEffect(() => {
        if (!ready.current) return;
        saveLS(LS_KEYS.employees, employees);
    }, [employees]);

    useEffect(() => {
        if (!ready.current) return;
        saveLS(LS_KEYS.positions, positions);
    }, [positions]);

    // Try Firebase; fallback to localStorage
    useEffect(() => {
        let unsubs = [];

        // 🧹 Clear old localStorage sample data on first load
        try {
            localStorage.removeItem(LS_KEYS.tasks);
            localStorage.removeItem(LS_KEYS.employees);
            localStorage.removeItem(LS_KEYS.positions);
        } catch { }

        const tryFirebase = async () => {
            console.log('🔥 Attempting Firebase connection...');
            try {
                const unsub1 = onSnapshot(collection(db, 'tasks'), snap => {
                    const data = snap.docs.map(d => normalizeTask({ id: d.id, ...d.data() }));
                    setTasks(data);
                    saveLS(LS_KEYS.tasks, data);
                    console.log(`✅ Loaded ${data.length} tasks from Firebase`);
                }, (err) => {
                    console.error('❌ Tasks listener error:', err.message);
                    fallbackToLocal(err);
                });

                const unsub2 = onSnapshot(collection(db, 'employees'), snap => {
                    const data = (snap.docs || []).map(d => {
                        const raw = d.data() || {};
                        return {
                            id: d.id,
                            // ✅ Default-safe fields (กันพังตอน render)
                            name: raw.name || raw.fullName || '',
                            nickname: raw.nickname || '',
                            department: raw.department || '',
                            role: raw.role || 'member',
                            photoUrl: raw.photoUrl || '',
                            tasksCount: typeof raw.tasksCount === 'number' ? raw.tasksCount : 0,
                            completedTasks: typeof raw.completedTasks === 'number' ? raw.completedTasks : 0,
                            responseRate: typeof raw.responseRate === 'number' ? raw.responseRate : 0,
                            pendingItems: Array.isArray(raw.pendingItems) ? raw.pendingItems : [],
                            color: raw.color || EMPLOYEE_COLORS[0],
                            ...raw,
                        };
                    });
                    setEmployees(Array.isArray(data) ? data : []);
                    saveLS(LS_KEYS.employees, data);
                    console.log(`✅ Loaded ${data.length} employees from Firebase`);
                }, (err) => {
                    console.error('❌ Employees listener error:', err.message);
                    fallbackToLocal(err);
                });

                const unsub3 = onSnapshot(collection(db, 'positions'), snap => {
                    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    setPositions(data);
                    saveLS(LS_KEYS.positions, data);
                    console.log(`✅ Loaded ${data.length} positions from Firebase`);
                }, (err) => {
                    console.error('❌ Positions listener error:', err.message);
                    fallbackToLocal(err);
                });

                // ✅ Subscribe projects collection
                const unsub4 = onSnapshot(collection(db, 'projects'), snap => {
                    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    setProjects(Array.isArray(data) ? data : []);
                    console.log(`✅ Loaded ${data.length} projects from Firebase`);
                }, (err) => {
                    console.error('❌ Projects listener error:', err.message);
                    fallbackToLocal(err);
                });

                unsubs = [unsub1, unsub2, unsub3, unsub4];
                setTimeout(() => { 
                    ready.current = true; 
                    setLoading(false);
                    console.log('✅ Firebase connection ready');
                }, 500);
            } catch (err) {
                console.error('❌ Firebase initialization error:', err.message);
                fallbackToLocal(err);
            }
        };

        const fallbackToLocal = (err) => {
            console.warn('⚠️ Falling back to local storage mode:', err?.message);
            ready.current = true;
            setLoading(false);
        };

        // ✅ Force use Firebase 100% (disable local fallback)
        if (useLocal || !db) {
            console.warn('⚠️ Firebase not available - using LOCAL mode only');
            ready.current = true;
            setLoading(false);
        } else {
            tryFirebase();
        }

        return () => unsubs.forEach(u => u && u());
    }, [useLocal]);

    // ── Firebase or localStorage write helpers ───────────────
    const fbOr = async (fbFn, localFn) => {
        if (useLocal) { localFn(); return; }
        try { await fbFn(); } catch { localFn(); }
    };

    // ── Tasks ────────────────────────────────────────────────
    const addTask = useCallback(async (task) => {
        const normalizedTask = normalizeTask(task);
        const tempId = `t${Date.now()}`;
        const newTask = { ...normalizedTask, id: normalizedTask.id || tempId };
        
        // Add to local state first (UI feedback)
        setTasks(p => { 
            const n = [...p, newTask]; 
            saveLS(LS_KEYS.tasks, n); 
            return n; 
        });

        // Then sync to Firebase
        let firebaseId = newTask.id;
        if (db) {
            try {
                const ref = await addDoc(collection(db, 'tasks'), normalizedTask);
                firebaseId = ref.id;
                console.log(`✅ Task added to Firebase:`, firebaseId);
                
                // Update state with actual Firebase ID if it was temp
                if (newTask.id === tempId) {
                    setTasks(p => { 
                        const n = p.map(t => t.id === tempId ? { ...t, id: firebaseId } : t);
                        saveLS(LS_KEYS.tasks, n);
                        return n;
                    });
                }
            } catch (err) {
                console.error(`❌ Firebase task add failed:`, {
                    errorCode: err.code,
                    errorMessage: err.message
                });
                // Keep local entry even if Firebase fails
            }
        } else {
            console.warn('⚠️ Firebase DB not initialized - task may not persist across sessions');
        }

        // 🔔 Trigger LINE Webhook (Cloudflare Pages Function) in the background
        const assigneeNames = employees
            .filter(emp => newTask.assignees?.includes(emp.id))
            .map(emp => emp.name);

        fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskName: newTask.name,
                assignees: assigneeNames,
                deadline: newTask.deadline || '',
                value: newTask.value || 0,
                type: newTask.type,
            })
        }).catch(err => console.error("Line Notify Failed:", err));

        newTask.id = firebaseId;
        return newTask;
    }, [employees]);

    const updateTask = useCallback(async (id, data) => {
        if (!id || !data) {
            console.warn('❌ updateTask: missing id or data', { id, data });
            return;
        }
        
        // Always try Firebase first - most important
        let firebaseSuccess = false;
        if (db) {
            try {
                const taskRef = doc(db, 'tasks', id);
                const updatePayload = {
                    ...data,
                    _lastUpdated: new Date().toISOString(),
                    _updatedFrom: 'web-modal'
                };
                await updateDoc(taskRef, updatePayload);
                firebaseSuccess = true;
                console.log(`✅ Task updated in Firebase: ${id}`, updatePayload);
            } catch (err) {
                console.error(`❌ Firebase task update failed for id=${id}:`, {
                    errorCode: err.code,
                    errorMessage: err.message,
                    data
                });
                // Don't fallback to local - keep trying Firebase
            }
        } else {
            console.warn('⚠️ Firebase DB not initialized - task update may not persist');
        }
        
        // Update local state (UI feedback)
        setTasks(p => {
            const n = p.map(t => t.id === id ? { ...t, ...data } : t);
            saveLS(LS_KEYS.tasks, n);
            return n;
        });
    }, []);

    const deleteTask = useCallback(async (id) => {
        if (!id) {
            console.warn('❌ deleteTask: missing id');
            return;
        }

        // Always try Firebase first
        let firebaseSuccess = false;
        if (db) {
            try {
                await deleteDoc(doc(db, 'tasks', id));
                firebaseSuccess = true;
                console.log(`✅ Task deleted from Firebase: ${id}`);
            } catch (err) {
                console.error(`❌ Firebase task delete failed for id=${id}:`, {
                    errorCode: err.code,
                    errorMessage: err.message
                });
                // Don't return - still update local
            }
        } else {
            console.warn('⚠️ Firebase DB not initialized - task delete may not persist');
        }
        
        // Update local state (UI feedback)
        setTasks(p => { 
            const n = p.filter(t => t.id !== id); 
            saveLS(LS_KEYS.tasks, n); 
            return n; 
        });
    }, []);

    // ── Employees ─────────────────────────────────────────────
    const addEmployee = useCallback(async (emp) => {
        const safeLength = Array.isArray(employees) ? employees.length : 0;
        const colorIndex = safeLength % EMPLOYEE_COLORS.length;
        const newEmp = { ...emp, id: `e${Date.now()}`, color: EMPLOYEE_COLORS[colorIndex] };
        await fbOr(
            async () => {
                const ref = await addDoc(collection(db, 'employees'), newEmp);
                newEmp.id = ref.id;
                setEmployees(p => { const n = [...p, newEmp]; saveLS(LS_KEYS.employees, n); return n; });
            },
            () => setEmployees(p => { const n = [...p, newEmp]; saveLS(LS_KEYS.employees, n); return n; })
        );
        return newEmp;
    }, [useLocal, employees]);

    const deleteEmployee = useCallback(async (id) => {
        if (useLocal) {
            setEmployees(p => {
                const n = p.filter(e => e.id !== id);
                saveLS(LS_KEYS.employees, n);
                return n;
            });
            return;
        }

        try {
            await deleteDoc(doc(db, 'employees', id));
            console.log('✅ Firestore employee deleted:', id);
        } catch (err) {
            console.error('❌ Firestore delete failed:', err);
            return; // ถ้าลบไม่สำเร็จ ไม่ต้องแก้ state
        }

        // ปล่อยให้ onSnapshot เป็นตัว sync state หลัก
    }, [useLocal]);

    const updateEmployee = useCallback(async (id, data) => {
        setEmployees(p => {
            const n = p.map(e => e.id === id ? { ...e, ...data } : e);
            saveLS(LS_KEYS.employees, n);
            return n;
        });
        if (!useLocal) {
            try { await updateDoc(doc(db, 'employees', id), data); } catch { }
        }
    }, [useLocal]);

    // ── Positions ─────────────────────────────────────────────
    const addPosition = useCallback(async (pos) => {
        const newPos = { ...pos, id: `p${Date.now()}` };
        await fbOr(
            async () => {
                const ref = await addDoc(collection(db, 'positions'), newPos);
                newPos.id = ref.id;
                setPositions(p => { const n = [...p, newPos]; saveLS(LS_KEYS.positions, n); return n; });
            },
            () => setPositions(p => { const n = [...p, newPos]; saveLS(LS_KEYS.positions, n); return n; })
        );
        return newPos;
    }, [useLocal]);

    const deletePosition = useCallback(async (id) => {
        setPositions(p => { const n = p.filter(pos => pos.id !== id); saveLS(LS_KEYS.positions, n); return n; });
        if (!useLocal) {
            try { await deleteDoc(doc(db, 'positions', id)); } catch { }
        }
    }, [useLocal]);

    return {
        tasks: Array.isArray(tasks) ? tasks : [],
        employees: Array.isArray(employees) ? employees : [],
        positions: Array.isArray(positions) ? positions : [],
        projects: Array.isArray(projects) ? projects : [],
        loading,
        addTask, updateTask, deleteTask,
        addEmployee, updateEmployee, deleteEmployee,
        addPosition, deletePosition,
        isLocal: useLocal,
    };
}
