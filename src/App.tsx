import { useState, useEffect, useCallback } from 'react';
import { 
  Search, Filter, ExternalLink, Building2, Landmark, Loader2, 
  AlertCircle, Info, Bookmark, BookmarkCheck, Bell, LogIn, 
  LogOut, User as UserIcon, Trash2, X, ChevronDown, Calendar, 
  DollarSign, Briefcase, History, Download, FileText, Map as MapIcon,
  LayoutGrid, ChevronLeft, ChevronRight, Share2, MoreVertical,
  GripVertical, ChevronRightSquare, ChevronLeftSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import Markdown from 'react-markdown';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Bidding, SearchFilters, SavedBidding, SearchAlert, SearchHistory, SavedFilter, BiddingStatus } from './types';
import { searchBiddings, summarizeBiddings } from './services/biddingService';
import { updateDoc } from 'firebase/firestore';

// Fix Leaflet icon issue
const DefaultIcon = L.divIcon({
    html: `<div style="background-color: #2563eb; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.3);"></div>`,
    className: 'custom-div-icon',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
});

L.Marker.prototype.options.icon = DefaultIcon;
import { cn } from './lib/utils';
import { 
  auth, db, googleProvider, googleProvider as provider, 
  handleFirestoreError, OperationType 
} from './firebase';
import { 
  signInWithPopup, signOut, onAuthStateChanged, User 
} from 'firebase/auth';
import { 
  collection, doc, setDoc, getDocs, query, where, 
  deleteDoc, onSnapshot, serverTimestamp, addDoc 
} from 'firebase/firestore';

type Tab = 'search' | 'saved' | 'alerts' | 'history';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    type: 'all',
    entityType: 'all',
    state: 'all'
  });
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Bidding[]>([]);
  const [savedBiddings, setSavedBiddings] = useState<SavedBidding[]>([]);
  const [alerts, setAlerts] = useState<SearchAlert[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [selectedBiddingForMap, setSelectedBiddingForMap] = useState<Bidding | null>(null);
  const [savedViewMode, setSavedViewMode] = useState<'list' | 'calendar' | 'kanban'>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const [calendarSelectedDay, setCalendarSelectedDay] = useState<{ day: number, biddings: Bidding[] } | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) {
        // Sync user profile
        setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          lastLogin: serverTimestamp()
        }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync Saved Biddings
  useEffect(() => {
    if (!user) {
      setSavedBiddings([]);
      return;
    }
    const q = query(collection(db, 'saved_biddings'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as SavedBidding));
      setSavedBiddings(data.sort((a, b) => b.savedAt - a.savedAt));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'saved_biddings'));
    return () => unsubscribe();
  }, [user]);

  // Sync Alerts
  useEffect(() => {
    if (!user) {
      setAlerts([]);
      return;
    }
    const q = query(collection(db, 'search_alerts'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as SearchAlert));
      setAlerts(data.sort((a, b) => b.createdAt - a.createdAt));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'search_alerts'));
    return () => unsubscribe();
  }, [user]);

  // Sync Search History
  useEffect(() => {
    if (!user) {
      setSearchHistory([]);
      return;
    }
    const q = query(collection(db, 'search_history'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as SearchHistory));
      setSearchHistory(data.sort((a, b) => b.timestamp - a.timestamp));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'search_history'));
    return () => unsubscribe();
  }, [user]);

  // Sync Saved Filters
  useEffect(() => {
    if (!user) {
      setSavedFilters([]);
      return;
    }
    const q = query(collection(db, 'saved_filters'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as SavedFilter));
      setSavedFilters(data.sort((a, b) => b.createdAt - a.createdAt));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'saved_filters'));
    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!filters.query.trim()) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setCurrentPage(1);
    
    try {
      const data = await searchBiddings(filters);
      setResults(data);
      
      // Save to history if user is logged in
      if (user && filters.query.trim()) {
        const historyItem: Omit<SearchHistory, 'id'> = {
          userId: user.uid,
          query: filters.query,
          filters: { ...filters },
          timestamp: Date.now()
        };
        addDoc(collection(db, 'search_history'), historyItem)
          .catch(e => handleFirestoreError(e, OperationType.CREATE, 'search_history'));
      }

      if (data.length === 0) {
        setError('Nenhuma licitação encontrada para esta busca. Tente termos mais genéricos ou ajuste os filtros.');
      }
    } catch (err) {
      setError('Ocorreu um erro ao buscar as licitações. Por favor, tente novamente.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSaveBidding = async (bidding: Bidding) => {
    if (!user) {
      handleLogin();
      return;
    }

    const existing = savedBiddings.find(s => s.link === bidding.link);
    if (existing) {
      try {
        await deleteDoc(doc(db, 'saved_biddings', existing.id));
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `saved_biddings/${existing.id}`);
      }
    } else {
      try {
        const saved: Omit<SavedBidding, 'id'> = {
          ...bidding,
          userId: user.uid,
          savedAt: Date.now(),
          status: 'Acompanhando'
        };
        await addDoc(collection(db, 'saved_biddings'), saved);
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'saved_biddings');
      }
    }
  };

  const updateBiddingStatus = async (id: string, status: BiddingStatus) => {
    try {
      await updateDoc(doc(db, 'saved_biddings', id), { status });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `saved_biddings/${id}`);
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId as BiddingStatus;
    updateBiddingStatus(draggableId, newStatus);
  };

  const triggerPushNotification = (title: string, body: string) => {
    if (!("Notification" in window)) {
      console.log("Este navegador não suporta notificações desktop");
      return;
    }

    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: '/favicon.ico' });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          new Notification(title, { body, icon: '/favicon.ico' });
        }
      });
    }
  };

  const createAlert = async () => {
    if (!user) {
      handleLogin();
      return;
    }
    if (!filters.query.trim()) return;

    try {
      const alert: Omit<SearchAlert, 'id'> = {
        userId: user.uid,
        name: `Alerta: ${filters.query}`,
        filters: { ...filters },
        createdAt: Date.now()
      };
      await addDoc(collection(db, 'search_alerts'), alert);
      triggerPushNotification("Alerta Criado!", `Você receberá notificações para: ${filters.query}`);
      setActiveTab('alerts');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'search_alerts');
    }
  };

  // Simulate alert monitoring
  useEffect(() => {
    if (!user) return;
    
    const interval = setInterval(() => {
      // In a real app, this would be handled by a backend/Cloud Function
      // Here we simulate finding a new bidding for a random alert
      const q = query(collection(db, 'search_alerts'), where('userId', '==', user.uid));
      getDocs(q).then(snapshot => {
        if (!snapshot.empty) {
          const alerts = snapshot.docs.map(d => d.data() as SearchAlert);
          const randomAlert = alerts[Math.floor(Math.random() * alerts.length)];
          
          // Randomly trigger a notification (10% chance every 2 minutes for demo)
          if (Math.random() > 0.9) {
            triggerPushNotification(
              "Nova Licitação Encontrada!", 
              `Uma nova oportunidade corresponde ao seu alerta: ${randomAlert.name}`
            );
          }
        }
      });
    }, 120000); // Check every 2 minutes

    return () => clearInterval(interval);
  }, [user]);

  const deleteAlert = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'search_alerts', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `search_alerts/${id}`);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'search_history', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `search_history/${id}`);
    }
  };

  const clearHistory = async () => {
    if (!user) return;
    try {
      const q = query(collection(db, 'search_history'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'search_history', d.id)));
      await Promise.all(deletePromises);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'search_history');
    }
  };

  const saveFilterSet = async (name: string) => {
    if (!user) return;
    try {
      const saved: Omit<SavedFilter, 'id'> = {
        userId: user.uid,
        name,
        filters: { ...filters },
        createdAt: Date.now()
      };
      await addDoc(collection(db, 'saved_filters'), saved);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'saved_filters');
    }
  };

  const deleteSavedFilter = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'saved_filters', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `saved_filters/${id}`);
    }
  };

  const isSaved = (link: string) => savedBiddings.some(s => s.link === link);

  const exportBiddingToTxt = (bidding: Bidding) => {
    const content = `
LICITADOR PRO - DETALHES DA LICITAÇÃO
--------------------------------------
Título: ${bidding.title}
Portal: ${bidding.portal}
Número: ${bidding.biddingNumber}
Processo: ${bidding.processNumber}
Tipo: ${bidding.type === 'public' ? 'Pública' : 'Privada'}
Esfera: ${bidding.entityType || 'N/A'}
Modalidade: ${bidding.biddingType || 'N/A'}
Valor Estimado: ${bidding.estimatedValue || 'Não informado'}
Data: ${bidding.date || 'Não informada'}
Localização: ${bidding.location || 'Não informada'}
Link: ${bidding.link}

OBJETO:
${bidding.object}
--------------------------------------
Gerado em: ${new Date().toLocaleString('pt-BR')}
    `.trim();

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `licitacao_${bidding.biddingNumber || bidding.id}.txt`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToPDF = (data: Bidding[], filename: string) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFillColor(37, 99, 235); // blue-600
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('LICITADOR PRO', 20, 25);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Relatório gerado em: ${new Date().toLocaleString('pt-BR')}`, 20, 33);
    
    // Summary
    doc.setTextColor(30, 41, 59); // slate-800
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total de Licitações: ${data.length}`, 20, 55);
    
    const tableData = data.map(b => [
      b.title,
      b.biddingNumber || 'N/A',
      b.portal,
      b.date || 'N/A',
      b.estimatedValue || 'N/A',
      b.location || 'N/A'
    ]);

    autoTable(doc, {
      startY: 65,
      head: [['Título', 'Número', 'Portal', 'Data', 'Valor', 'Localização']],
      body: tableData,
      theme: 'grid',
      headStyles: { 
        fillColor: [37, 99, 235], 
        textColor: [255, 255, 255],
        fontSize: 10,
        fontStyle: 'bold'
      },
      styles: { 
        fontSize: 8,
        cellPadding: 3,
        overflow: 'linebreak'
      },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 25 },
        2: { cellWidth: 25 },
        3: { cellWidth: 20 },
        4: { cellWidth: 25 },
        5: { cellWidth: 35 }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    doc.save(`${filename}_${Date.now()}.pdf`);
  };

  const exportToCSV = (data: Bidding[], filename: string) => {
    const headers = ['Título', 'Objeto', 'Número', 'Processo', 'Portal', 'Link', 'Tipo', 'Esfera', 'Modalidade', 'Valor', 'Data', 'Localização'];
    const csvContent = [
      headers.join(','),
      ...data.map(b => [
        `"${b.title.replace(/"/g, '""')}"`,
        `"${b.object.replace(/"/g, '""')}"`,
        `"${b.biddingNumber}"`,
        `"${b.processNumber}"`,
        `"${b.portal}"`,
        `"${b.link}"`,
        `"${b.type}"`,
        `"${b.entityType}"`,
        `"${b.biddingType || ''}"`,
        `"${b.estimatedValue || ''}"`,
        `"${b.date}"`,
        `"${b.location || ''}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateSummary = async (data: Bidding[]) => {
    setIsSummarizing(true);
    try {
      const text = await summarizeBiddings(data);
      setSummary(text);
    } catch (e) {
      console.error(e);
      setError("Erro ao gerar resumo.");
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab('search')}>
            <div className="bg-blue-600 p-2 rounded-lg">
              <Landmark className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Licitador<span className="text-blue-600">Pro</span></h1>
          </div>
          
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 mr-4">
              <button 
                onClick={() => setActiveTab('search')}
                className={cn("hover:text-blue-600 transition-colors", activeTab === 'search' && "text-blue-600")}
              >
                Buscar
              </button>
              <button 
                onClick={() => setActiveTab('saved')}
                className={cn("hover:text-blue-600 transition-colors flex items-center gap-1", activeTab === 'saved' && "text-blue-600")}
              >
                Salvas
                {savedBiddings.length > 0 && <span className="bg-blue-100 text-blue-600 text-[10px] px-1.5 py-0.5 rounded-full">{savedBiddings.length}</span>}
              </button>
              <button 
                onClick={() => setActiveTab('alerts')}
                className={cn("hover:text-blue-600 transition-colors flex items-center gap-1", activeTab === 'alerts' && "text-blue-600")}
              >
                Alertas
                {alerts.length > 0 && <span className="bg-blue-100 text-blue-600 text-[10px] px-1.5 py-0.5 rounded-full">{alerts.length}</span>}
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={cn("hover:text-blue-600 transition-colors flex items-center gap-1", activeTab === 'history' && "text-blue-600")}
              >
                Histórico
              </button>
            </nav>

            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-slate-900">{user.displayName}</p>
                  <button onClick={handleLogout} className="text-[10px] text-slate-500 hover:text-red-500 transition-colors">Sair</button>
                </div>
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-slate-200" />
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm"
              >
                <LogIn className="w-4 h-4" />
                Entrar
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 md:py-12 pb-24 md:pb-12">
        <AnimatePresence mode="wait">
          {activeTab === 'search' && (
            <motion.div
              key="search-tab"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              {/* Hero Section */}
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">
                  Busca Inteligente de Licitações
                </h2>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Acesse editais de portais federais, estaduais, municipais e privados em um só lugar.
                </p>
              </div>

              {/* Search & Filters */}
              <div className="mb-12 space-y-4">
                <form onSubmit={handleSearch} className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    <Search className="w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                  </div>
                  <input
                    type="text"
                    value={filters.query}
                    onChange={(e) => setFilters(prev => ({ ...prev, query: e.target.value }))}
                    placeholder="Ex: Construção de escolas, manutenção de TI..."
                    className="w-full pl-12 pr-28 sm:pr-40 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-base sm:text-lg"
                  />
                  <div className="absolute right-2 top-2 bottom-2 flex gap-1 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => setShowFilters(!showFilters)}
                      className={cn(
                        "px-3 sm:px-4 rounded-xl border transition-all flex items-center gap-2 font-semibold text-sm",
                        showFilters ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      <Filter className="w-4 h-4" />
                      <span className="hidden sm:inline">Filtros</span>
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 sm:px-6 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                        <>
                          <Search className="w-4 h-4 sm:hidden" />
                          <span className="hidden sm:inline">Buscar</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Advanced Filters Panel */}
                <AnimatePresence>
                  {showFilters && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-white border border-slate-200 rounded-2xl p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 shadow-sm">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                            <Building2 className="w-3 h-3" /> Tipo de Portal
                          </label>
                          <select 
                            value={filters.type}
                            onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value as any }))}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-sm"
                          >
                            <option value="all">Todos os Portais</option>
                            <option value="public">Apenas Públicos</option>
                            <option value="private">Apenas Privados</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                            <Landmark className="w-3 h-3" /> Esfera/Órgão
                          </label>
                          <select 
                            value={filters.entityType}
                            onChange={(e) => setFilters(prev => ({ ...prev, entityType: e.target.value as any }))}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-sm"
                          >
                            <option value="all">Todas as Esferas</option>
                            <option value="federal">Federal</option>
                            <option value="state">Estadual</option>
                            <option value="municipal">Municipal</option>
                            <option value="private">Privado</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                            <Landmark className="w-3 h-3" /> Estado (UF)
                          </label>
                          <select 
                            value={filters.state || 'all'}
                            onChange={(e) => setFilters(prev => ({ ...prev, state: e.target.value }))}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-sm"
                          >
                            <option value="all">Todos os Estados</option>
                            <option value="AC">Acre</option>
                            <option value="AL">Alagoas</option>
                            <option value="AP">Amapá</option>
                            <option value="AM">Amazonas</option>
                            <option value="BA">Bahia</option>
                            <option value="CE">Ceará</option>
                            <option value="DF">Distrito Federal</option>
                            <option value="ES">Espírito Santo</option>
                            <option value="GO">Goiás</option>
                            <option value="MA">Maranhão</option>
                            <option value="MT">Mato Grosso</option>
                            <option value="MS">Mato Grosso do Sul</option>
                            <option value="MG">Minas Gerais</option>
                            <option value="PA">Pará</option>
                            <option value="PB">Paraíba</option>
                            <option value="PR">Paraná</option>
                            <option value="PE">Pernambuco</option>
                            <option value="PI">Piauí</option>
                            <option value="RJ">Rio de Janeiro</option>
                            <option value="RN">Rio Grande do Norte</option>
                            <option value="RS">Rio Grande do Sul</option>
                            <option value="RO">Rondônia</option>
                            <option value="RR">Roraima</option>
                            <option value="SC">Santa Catarina</option>
                            <option value="SP">São Paulo</option>
                            <option value="SE">Sergipe</option>
                            <option value="TO">Tocantins</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                            <Briefcase className="w-3 h-3" /> Modalidade
                          </label>
                          <input 
                            type="text"
                            list="modalities"
                            value={filters.biddingType || ''}
                            onChange={(e) => setFilters(prev => ({ ...prev, biddingType: e.target.value }))}
                            placeholder="Ex: Pregão Eletrônico, Concorrência..."
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-sm"
                          />
                          <datalist id="modalities">
                            <option value="Pregão Eletrônico" />
                            <option value="Pregão Presencial" />
                            <option value="Concorrência" />
                            <option value="Tomada de Preços" />
                            <option value="Convite" />
                            <option value="Leilão" />
                            <option value="Concurso" />
                            <option value="Dispensa de Licitação" />
                            <option value="Inexigibilidade" />
                            <option value="Chamamento Público" />
                          </datalist>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> Data Publicação
                            </label>
                            <div className="flex gap-1">
                              {[
                                { label: 'Última Semana', days: 7 },
                                { label: 'Último Mês', days: 30 },
                                { label: '90 dias', days: 90 },
                                { label: '1 ano', days: 365 }
                              ].map(p => (
                                <button
                                  key={p.label}
                                  type="button"
                                  onClick={() => {
                                    const date = new Date();
                                    date.setDate(date.getDate() - p.days);
                                    setFilters(prev => ({ 
                                      ...prev, 
                                      minDate: date.toISOString().split('T')[0],
                                      maxDate: new Date().toISOString().split('T')[0]
                                    }));
                                  }}
                                  className="text-[10px] px-2 py-0.5 bg-slate-200 hover:bg-blue-100 text-slate-600 rounded transition-colors font-bold"
                                >
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input 
                              type="date"
                              value={filters.minDate || ''}
                              onChange={(e) => setFilters(prev => ({ ...prev, minDate: e.target.value }))}
                              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-xs"
                            />
                            <span className="text-slate-400">até</span>
                            <input 
                              type="date"
                              value={filters.maxDate || ''}
                              onChange={(e) => setFilters(prev => ({ ...prev, maxDate: e.target.value }))}
                              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-xs"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> Valor Estimado
                          </label>
                          <div className="flex items-center gap-2">
                            <input 
                              type="number"
                              value={filters.minValue || ''}
                              onChange={(e) => setFilters(prev => ({ ...prev, minValue: e.target.value }))}
                              placeholder="Min"
                              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-sm"
                            />
                            <span className="text-slate-400">-</span>
                            <input 
                              type="number"
                              value={filters.maxValue || ''}
                              onChange={(e) => setFilters(prev => ({ ...prev, maxValue: e.target.value }))}
                              placeholder="Max"
                              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-sm"
                            />
                          </div>
                        </div>

                        <div className="flex items-end gap-3">
                          <button 
                            onClick={() => {
                              const name = prompt("Nome para este conjunto de filtros:");
                              if (name) saveFilterSet(name);
                            }}
                            className="text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1"
                          >
                            <Bookmark className="w-3 h-3" />
                            Salvar Filtros
                          </button>
                          <button 
                            onClick={() => setFilters({ query: filters.query, type: 'all', entityType: 'all', state: 'all' })}
                            className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            Limpar Filtros
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Saved Filters Section */}
                {user && savedFilters.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider self-center mr-2">Filtros Salvos:</span>
                    {savedFilters.map(sf => (
                      <div key={sf.id} className="group relative">
                        <button 
                          onClick={() => {
                            setFilters(sf.filters);
                          }}
                          className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-600 hover:border-blue-400 hover:bg-blue-50 transition-all flex items-center gap-1.5"
                        >
                          <Bookmark className="w-2.5 h-2.5 text-blue-500" />
                          {sf.name}
                        </button>
                        <button 
                          onClick={() => deleteSavedFilter(sf.id)}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {hasSearched && !loading && results.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <button 
                      onClick={() => exportToCSV(results, 'resultados_busca')}
                      className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-xl transition-all"
                    >
                      <Download className="w-4 h-4" />
                      CSV
                    </button>
                    <button 
                      onClick={() => exportToPDF(results, 'resultados_busca')}
                      className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-xl transition-all"
                    >
                      <FileText className="w-4 h-4 text-red-500" />
                      PDF
                    </button>
                    <button 
                      onClick={() => handleGenerateSummary(results)}
                      disabled={isSummarizing}
                      className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-xl transition-all"
                    >
                      {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      Resumo IA
                    </button>
                    <button 
                      onClick={createAlert}
                      className="flex items-center gap-2 text-sm font-bold text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-xl transition-all"
                    >
                      <Bell className="w-4 h-4" />
                      Criar Alerta
                    </button>
                  </div>
                )}
              </div>

              {/* Results Area */}
              <div className="space-y-6">
                <AnimatePresence mode="wait">
                  {loading ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-20 text-slate-500"
                    >
                      <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
                      <p className="text-lg font-medium">Consultando portais e editais...</p>
                      <p className="text-sm">Isso pode levar alguns segundos enquanto nossa IA varre a web.</p>
                    </motion.div>
                  ) : error ? (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-amber-50 border border-amber-200 p-6 rounded-2xl flex items-start gap-4"
                    >
                      <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-bold text-amber-900 mb-1">Aviso</h3>
                        <p className="text-amber-800">{error}</p>
                      </div>
                    </motion.div>
                  ) : results.length > 0 ? (
                    <motion.div
                      key="results"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-6"
                    >
                      <div className="grid gap-6">
                        {results.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((bidding, idx) => (
                          <BiddingCard 
                            key={bidding.id} 
                            bidding={bidding} 
                            isSaved={isSaved(bidding.link)}
                            onSave={() => toggleSaveBidding(bidding)}
                            onShowMap={setSelectedBiddingForMap}
                            onExportTxt={exportBiddingToTxt}
                            searchQuery={filters.query}
                            idx={idx}
                          />
                        ))}
                      </div>
                      
                      {results.length > itemsPerPage && (
                        <div className="flex flex-col items-center gap-6 pt-8">
                          <div className="flex items-center justify-center gap-4">
                            <button 
                              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                              disabled={currentPage === 1}
                              className="p-2 rounded-xl border border-slate-200 hover:bg-white disabled:opacity-30 transition-all bg-white shadow-sm"
                            >
                              <ChevronLeftSquare className="w-6 h-6" />
                            </button>
                            <div className="flex items-center gap-2">
                              {Array.from({ length: Math.ceil(results.length / itemsPerPage) }).map((_, i) => {
                                const pageNum = i + 1;
                                // Show first, last, and pages around current
                                if (
                                  pageNum === 1 || 
                                  pageNum === Math.ceil(results.length / itemsPerPage) ||
                                  (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                                ) {
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => setCurrentPage(pageNum)}
                                      className={cn(
                                        "w-10 h-10 rounded-xl text-sm font-bold transition-all",
                                        currentPage === pageNum ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-white border border-slate-200 text-slate-500 hover:border-blue-300"
                                      )}
                                    >
                                      {pageNum}
                                    </button>
                                  );
                                }
                                if (pageNum === 2 || pageNum === Math.ceil(results.length / itemsPerPage) - 1) {
                                  return <span key={i} className="text-slate-300">...</span>;
                                }
                                return null;
                              })}
                            </div>
                            <button 
                              onClick={() => setCurrentPage(prev => Math.min(Math.ceil(results.length / itemsPerPage), prev + 1))}
                              disabled={currentPage === Math.ceil(results.length / itemsPerPage)}
                              className="p-2 rounded-xl border border-slate-200 hover:bg-white disabled:opacity-30 transition-all bg-white shadow-sm"
                            >
                              <ChevronRightSquare className="w-6 h-6" />
                            </button>
                          </div>
                          <div className="text-sm text-slate-500 font-medium">
                            Página <span className="text-slate-900">{currentPage}</span> de <span className="text-slate-900">{Math.ceil(results.length / itemsPerPage)}</span>
                            <span className="mx-2">•</span>
                            Mostrando <span className="text-slate-900">{(currentPage - 1) * itemsPerPage + 1}</span>-
                            <span className="text-slate-900">{Math.min(currentPage * itemsPerPage, results.length)}</span> de 
                            <span className="text-slate-900 ml-1">{results.length}</span> resultados
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ) : hasSearched ? (
                    <div className="text-center py-20 text-slate-400">
                      <Info className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p>Nenhum resultado para exibir.</p>
                    </div>
                  ) : (
                    <div className="text-center py-20">
                      <div className="max-w-md mx-auto bg-blue-50 p-8 rounded-3xl border border-blue-100">
                        <Landmark className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-blue-900 mb-2">Comece sua busca</h3>
                        <p className="text-blue-700 text-sm">
                          Digite palavras-chave relacionadas ao seu setor para encontrar oportunidades de negócio em todo o Brasil.
                        </p>
                      </div>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {activeTab === 'saved' && (
            <motion.div
              key="saved-tab"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Bookmark className="w-6 h-6 text-blue-600" />
                    Licitações Salvas
                  </h2>
                  <div className="relative hidden sm:block">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text"
                      placeholder="Filtrar salvas..."
                      value={savedSearchQuery}
                      onChange={(e) => setSavedSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-1.5 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-48 transition-all"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {savedBiddings.length > 0 && (
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setSavedViewMode('list')}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                          savedViewMode === 'list' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        Lista
                      </button>
                      <button 
                        onClick={() => setSavedViewMode('kanban')}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                          savedViewMode === 'kanban' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                        Kanban
                      </button>
                      <button 
                        onClick={() => setSavedViewMode('calendar')}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                          savedViewMode === 'calendar' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Calendário
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {savedBiddings.length > 0 && (
                      <>
                        <button 
                          onClick={() => exportToCSV(savedBiddings, 'licitacoes_salvas')}
                          className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                        >
                          <Download className="w-4 h-4" />
                          CSV
                        </button>
                        <button 
                          onClick={() => exportToPDF(savedBiddings, 'licitacoes_salvas')}
                          className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                        >
                          <FileText className="w-4 h-4 text-red-500" />
                          PDF
                        </button>
                        <button 
                          onClick={() => handleGenerateSummary(savedBiddings)}
                          disabled={isSummarizing}
                          className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                        >
                          {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                          Resumo IA
                        </button>
                      </>
                    )}
                    <p className="text-sm text-slate-500 font-medium">{savedBiddings.length} itens salvos</p>
                  </div>
                </div>
              </div>

              {/* Mobile Search for Saved */}
              <div className="mb-6 sm:hidden">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text"
                    placeholder="Filtrar salvas..."
                    value={savedSearchQuery}
                    onChange={(e) => setSavedSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
              </div>

              {!user ? (
                <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl p-12">
                  <UserIcon className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Faça login para salvar</h3>
                  <p className="text-slate-500 mb-6 max-w-sm mx-auto">Salve licitações interessantes para acompanhar o processo e acessar os editais rapidamente.</p>
                  <button onClick={handleLogin} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">Entrar com Google</button>
                </div>
              ) : savedBiddings.length === 0 ? (
                <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl p-12">
                  <Bookmark className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Nenhuma licitação salva</h3>
                  <p className="text-slate-500 mb-6">Suas licitações marcadas aparecerão aqui.</p>
                  <button onClick={() => setActiveTab('search')} className="text-blue-600 font-bold hover:underline">Ir para a busca</button>
                </div>
              ) : savedViewMode === 'calendar' ? (
                <BiddingCalendar 
                  biddings={savedBiddings} 
                  onDayClick={(day, biddings) => setCalendarSelectedDay({ day, biddings })}
                />
              ) : savedViewMode === 'kanban' ? (
                <BiddingKanban 
                  biddings={savedBiddings} 
                  onDragEnd={onDragEnd}
                  onSave={toggleSaveBidding}
                />
              ) : (
                <div className="grid gap-6">
                  {savedBiddings
                    .filter(b => 
                      b.title.toLowerCase().includes(savedSearchQuery.toLowerCase()) || 
                      b.object.toLowerCase().includes(savedSearchQuery.toLowerCase())
                    )
                    .map((bidding, idx) => (
                      <BiddingCard 
                        key={bidding.id} 
                        bidding={bidding} 
                        isSaved={true}
                        onSave={() => toggleSaveBidding(bidding)}
                        onShowMap={setSelectedBiddingForMap}
                        onExportTxt={exportBiddingToTxt}
                        searchQuery={savedSearchQuery}
                        idx={idx}
                      />
                    ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'alerts' && (
            <motion.div
              key="alerts-tab"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  <Bell className="w-6 h-6 text-blue-600" />
                  Meus Alertas
                </h2>
                <p className="text-sm text-slate-500 font-medium">{alerts.length} alertas ativos</p>
              </div>

              {!user ? (
                <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl p-12">
                  <Bell className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Monitore licitações</h3>
                  <p className="text-slate-500 mb-6 max-w-sm mx-auto">Crie alertas baseados em seus critérios e receba notificações sempre que novas oportunidades surgirem.</p>
                  <button onClick={handleLogin} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">Entrar com Google</button>
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl p-12">
                  <Bell className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Nenhum alerta criado</h3>
                  <p className="text-slate-500 mb-6">Crie um alerta a partir de uma busca para ser notificado sobre novos editais.</p>
                  <button onClick={() => setActiveTab('search')} className="text-blue-600 font-bold hover:underline">Ir para a busca</button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {alerts.map((alert) => (
                    <div key={alert.id} className="bg-white border border-slate-200 p-6 rounded-2xl flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="bg-blue-50 p-3 rounded-xl">
                          <Bell className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900">{alert.name}</h4>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase">Termo: {alert.filters.query}</span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase">Portal: {alert.filters.type}</span>
                            {alert.filters.entityType !== 'all' && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase">{alert.filters.entityType}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => { setFilters(alert.filters); setActiveTab('search'); handleSearch(); }}
                          className="text-sm font-bold text-blue-600 hover:underline"
                        >
                          Executar agora
                        </button>
                        <button 
                          onClick={() => deleteAlert(alert.id)}
                          className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div
              key="history-tab"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-6 h-6 text-blue-600" />
                  Histórico de Busca
                </h2>
                {searchHistory.length > 0 && (
                  <button 
                    onClick={clearHistory}
                    className="text-sm font-bold text-red-500 hover:text-red-600 flex items-center gap-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Limpar Tudo
                  </button>
                )}
              </div>

              {!user ? (
                <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl p-12">
                  <History className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Acesse seu histórico</h3>
                  <p className="text-slate-500 mb-6 max-w-sm mx-auto">Faça login para ver suas buscas anteriores e reencontrar oportunidades facilmente.</p>
                  <button onClick={handleLogin} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">Entrar com Google</button>
                </div>
              ) : searchHistory.length === 0 ? (
                <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl p-12">
                  <History className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Nenhuma busca recente</h3>
                  <p className="text-slate-500 mb-6">Suas pesquisas aparecerão aqui para acesso rápido.</p>
                  <button onClick={() => setActiveTab('search')} className="text-blue-600 font-bold hover:underline">Fazer uma busca</button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {searchHistory.map((item) => (
                    <div key={item.id} className="bg-white border border-slate-200 p-6 rounded-2xl flex items-center justify-between shadow-sm hover:border-blue-200 transition-colors group">
                      <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => { setFilters(item.filters); setActiveTab('search'); handleSearch(); }}>
                        <div className="bg-slate-50 p-3 rounded-xl group-hover:bg-blue-50 transition-colors">
                          <Search className="w-6 h-6 text-slate-400 group-hover:text-blue-600" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900">{item.query}</h4>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-[10px] text-slate-400 font-medium">
                              {new Date(item.timestamp).toLocaleString('pt-BR')}
                            </span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase">{item.filters.type}</span>
                            {item.filters.entityType !== 'all' && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase">{item.filters.entityType}</span>}
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteHistoryItem(item.id)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Calendar Day Modal */}
      <AnimatePresence>
        {calendarSelectedDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <Calendar className="w-6 h-6 text-blue-600" />
                  Licitações do dia {calendarSelectedDay.day}
                </h3>
                <button onClick={() => setCalendarSelectedDay(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto space-y-4">
                {calendarSelectedDay.biddings.map((bidding, idx) => (
                  <BiddingCard 
                    key={bidding.id} 
                    bidding={bidding} 
                    isSaved={isSaved(bidding.link)}
                    onSave={() => toggleSaveBidding(bidding)}
                    onShowMap={setSelectedBiddingForMap}
                    onExportTxt={exportBiddingToTxt}
                    idx={idx}
                  />
                ))}
              </div>
              <div className="p-4 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setCalendarSelectedDay(null)}
                  className="px-6 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Summary Modal */}
      <AnimatePresence>
        {summary && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-blue-600 text-white">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <FileText className="w-6 h-6" />
                  Relatório Resumido (IA)
                </h3>
                <button onClick={() => setSummary(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-8 overflow-y-auto prose prose-slate max-w-none">
                <Markdown>{summary}</Markdown>
              </div>
              <div className="p-6 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setSummary(null)}
                  className="px-6 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Map Modal */}
      <AnimatePresence>
        {selectedBiddingForMap && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Localização do Órgão</h3>
                  <p className="text-sm text-slate-500">{selectedBiddingForMap.location}</p>
                </div>
                <button onClick={() => setSelectedBiddingForMap(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 relative">
                <MapContainer 
                  center={[selectedBiddingForMap.latitude || -15.7801, selectedBiddingForMap.longitude || -47.9292]} 
                  zoom={13} 
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  <Marker position={[selectedBiddingForMap.latitude || -15.7801, selectedBiddingForMap.longitude || -47.9292]}>
                    <Popup>
                      <div className="font-sans">
                        <p className="font-bold">{selectedBiddingForMap.title}</p>
                        <p className="text-xs">{selectedBiddingForMap.location}</p>
                      </div>
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="bg-white border-t border-slate-200 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="bg-slate-200 p-1.5 rounded-md">
              <Landmark className="text-slate-600 w-4 h-4" />
            </div>
            <span className="font-bold text-slate-800">LicitadorPro</span>
          </div>
          <p className="text-slate-500 text-sm text-center">
            © 2026 LicitadorPro. Dados agregados via IA de portais públicos e privados.
          </p>
          <div className="flex gap-6 text-slate-400">
            <a href="#" className="hover:text-blue-600 transition-colors">Termos</a>
            <a href="#" className="hover:text-blue-600 transition-colors">Privacidade</a>
            <a href="#" className="hover:text-blue-600 transition-colors">Contato</a>
          </div>
        </div>
      </footer>

      {/* Bottom Navigation (Mobile) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 px-6 py-3 flex justify-between items-center shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setActiveTab('search')}
          className={cn("flex flex-col items-center gap-1 transition-all active:scale-90", activeTab === 'search' ? "text-blue-600" : "text-slate-400")}
        >
          <Search className="w-5 h-5" />
          <span className="text-[10px] font-bold">Busca</span>
        </button>
        <button 
          onClick={() => setActiveTab('saved')}
          className={cn("flex flex-col items-center gap-1 relative transition-all active:scale-90", activeTab === 'saved' ? "text-blue-600" : "text-slate-400")}
        >
          <Bookmark className="w-5 h-5" />
          <span className="text-[10px] font-bold">Salvas</span>
          {savedBiddings.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[8px] w-4 h-4 flex items-center justify-center rounded-full border-2 border-white">
              {savedBiddings.length}
            </span>
          )}
        </button>
        <button 
          onClick={() => setActiveTab('alerts')}
          className={cn("flex flex-col items-center gap-1 relative transition-all active:scale-90", activeTab === 'alerts' ? "text-blue-600" : "text-slate-400")}
        >
          <Bell className="w-5 h-5" />
          <span className="text-[10px] font-bold">Alertas</span>
          {alerts.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[8px] w-4 h-4 flex items-center justify-center rounded-full border-2 border-white">
              {alerts.length}
            </span>
          )}
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={cn("flex flex-col items-center gap-1 transition-all active:scale-90", activeTab === 'history' ? "text-blue-600" : "text-slate-400")}
        >
          <History className="w-5 h-5" />
          <span className="text-[10px] font-bold">Histórico</span>
        </button>
      </div>
    </div>
  );
}

function BiddingKanban({ biddings, onDragEnd, onSave }: { 
  biddings: SavedBidding[], 
  onDragEnd: (result: DropResult) => void,
  onSave: (b: Bidding) => void
}) {
  const columns: { id: BiddingStatus, title: string, color: string }[] = [
    { id: 'Acompanhando', title: 'Acompanhando', color: 'bg-blue-50 border-blue-200 text-blue-700' },
    { id: 'Análise', title: 'Em Análise', color: 'bg-amber-50 border-amber-200 text-amber-700' },
    { id: 'Finalizada', title: 'Finalizada', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' }
  ];

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {columns.map(column => (
          <div key={column.id} className="flex flex-col h-full min-h-[500px]">
            <div className={cn("p-4 rounded-t-2xl border-b-0 border font-bold flex items-center justify-between", column.color)}>
              <span className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", column.color.split(' ')[2].replace('text', 'bg'))} />
                {column.title}
              </span>
              <span className="text-xs bg-white/50 px-2 py-0.5 rounded-full">
                {biddings.filter(b => b.status === column.id).length}
              </span>
            </div>
            <Droppable droppableId={column.id}>
              {(provided, snapshot) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className={cn(
                    "flex-1 p-4 bg-slate-50/50 border border-t-0 border-slate-200 rounded-b-2xl transition-colors",
                    snapshot.isDraggingOver && "bg-slate-100"
                  )}
                >
                  <div className="space-y-4">
                    {biddings
                      .filter(b => b.status === column.id)
                      .map((bidding, index) => (
                        <Draggable key={bidding.id} draggableId={bidding.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={{ ...provided.draggableProps.style }}
                              className={cn(
                                "bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative",
                                snapshot.isDragging && "shadow-xl ring-2 ring-blue-500/20 border-blue-500 rotate-2"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <h5 className="text-sm font-bold text-slate-900 line-clamp-2 leading-tight">
                                  {bidding.title}
                                </h5>
                                <button 
                                  onClick={() => onSave(bidding)}
                                  className="text-slate-300 hover:text-red-500 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              <p className="text-[11px] text-slate-500 line-clamp-2 mb-3">
                                {bidding.object}
                              </p>
                              <div className="flex items-center justify-between mt-auto">
                                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {bidding.date || 'N/A'}
                                </span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <GripVertical className="w-3.5 h-3.5 text-slate-300" />
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  );
}

function BiddingCalendar({ biddings, onDayClick }: { biddings: Bidding[], onDayClick: (day: number, biddings: Bidding[]) => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const getBiddingsForDay = (day: number) => {
    return biddings.filter(b => {
      if (!b.date) return false;
      const parts = b.date.split('/');
      if (parts.length !== 3) return false;
      const bDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return bDate.getDate() === day && 
             bDate.getMonth() === currentDate.getMonth() && 
             bDate.getFullYear() === currentDate.getFullYear();
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <h3 className="text-lg font-bold text-slate-800">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h3>
        <div className="flex gap-2">
          <button onClick={prevMonth} className="p-2 hover:bg-white rounded-xl border border-slate-200 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={nextMonth} className="p-2 hover:bg-white rounded-xl border border-slate-200 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-7 border-b border-slate-100">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
          <div key={d} className="py-3 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {d}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} className="h-32 border-r border-b border-slate-50 bg-slate-50/30" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayBiddings = getBiddingsForDay(day);
          const isToday = new Date().toDateString() === new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toDateString();
          const hasBiddings = dayBiddings.length > 0;
          
          return (
            <div 
              key={day} 
              onClick={() => hasBiddings && onDayClick(day, dayBiddings)}
              className={cn(
                "h-32 border-r border-b border-slate-100 p-2 transition-all group relative cursor-default",
                hasBiddings && "cursor-pointer hover:bg-blue-50/50",
                isToday && "bg-blue-50/30"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full",
                  isToday ? "bg-blue-600 text-white" : "text-slate-500",
                  hasBiddings && !isToday && "bg-blue-100 text-blue-700"
                )}>
                  {day}
                </span>
                {hasBiddings && (
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                )}
              </div>
              <div className="space-y-1 overflow-y-auto max-h-[80px] scrollbar-hide">
                {dayBiddings.slice(0, 3).map((b, idx) => (
                  <div key={idx} className="text-[9px] leading-tight p-1 rounded bg-white border border-slate-200 text-slate-700 truncate shadow-sm group-hover:border-blue-200">
                    {b.title}
                  </div>
                ))}
                {dayBiddings.length > 3 && (
                  <div className="text-[8px] font-bold text-blue-600 text-center">
                    + {dayBiddings.length - 3} mais
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HighlightText({ text, query }: { text: string, query: string }) {
  if (!query.trim()) return <>{text}</>;
  
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return <>{text}</>;
  
  // Escape special characters for regex
  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{part}</mark>
        ) : (
          part
        )
      )}
    </>
  );
}

function BiddingCard({ bidding, isSaved, onSave, idx, onShowMap, searchQuery, onExportTxt }: { 
  bidding: Bidding, 
  isSaved: boolean, 
  onSave: () => void, 
  idx: number,
  onShowMap?: (b: Bidding) => void,
  searchQuery?: string,
  onExportTxt?: (b: Bidding) => void
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: bidding.title,
          text: bidding.object,
          url: bidding.link,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      navigator.clipboard.writeText(bidding.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ 
        scale: 1.02, 
        translateY: -4,
        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)"
      }}
      transition={{ 
        delay: idx * 0.05,
        type: "spring",
        stiffness: 300,
        damping: 20
      }}
      className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm hover:border-blue-300 transition-all group relative"
    >
      <div className="absolute top-6 right-6 flex items-center gap-2">
        <button 
          onClick={() => onExportTxt?.(bidding)}
          className="p-2 bg-slate-50 text-slate-400 hover:text-blue-600 rounded-xl transition-all"
          title="Exportar TXT"
        >
          <FileText className="w-5 h-5" />
        </button>
        <div className="relative">
          <button 
            onClick={handleShare}
            className={cn(
              "p-2 rounded-xl transition-all",
              copied ? "bg-emerald-500 text-white" : "bg-slate-50 text-slate-400 hover:text-blue-600"
            )}
            title="Compartilhar"
          >
            {copied ? <BookmarkCheck className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
          </button>
          <AnimatePresence>
            {copied && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10"
              >
                Link Copiado!
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button 
          onClick={onSave}
          className={cn(
            "p-2 rounded-xl transition-all",
            isSaved ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-slate-50 text-slate-400 hover:text-blue-600"
          )}
        >
          {isSaved ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pr-24">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={cn(
              "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full",
              bidding.type === 'public' ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
            )}>
              {bidding.type === 'public' ? 'Pública' : 'Privada'}
            </span>
            {bidding.entityType && (
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {bidding.entityType}
              </span>
            )}
            {bidding.biddingType && (
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                {bidding.biddingType}
              </span>
            )}
            <span className="text-xs text-slate-400 font-medium">•</span>
            <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {bidding.portal}
            </span>
          </div>
          <h4 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">
            <HighlightText text={bidding.title} query={searchQuery || ''} />
          </h4>
          <p className="text-slate-600 text-sm mb-4 line-clamp-3 leading-relaxed">
            <HighlightText text={bidding.object} query={searchQuery || ''} />
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-slate-400 text-[10px] uppercase font-bold mb-1">Nº Pregão/Edital</p>
              <p className="font-mono font-medium text-slate-700 truncate">{bidding.biddingNumber}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-slate-400 text-[10px] uppercase font-bold mb-1">Processo</p>
              <p className="font-mono font-medium text-slate-700 truncate">{bidding.processNumber}</p>
            </div>
            {bidding.estimatedValue && (
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                <p className="text-blue-400 text-[10px] uppercase font-bold mb-1">Valor Estimado</p>
                <p className="font-bold text-blue-700">{bidding.estimatedValue}</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex flex-col gap-2 shrink-0 md:mt-8">
          <a
            href={bidding.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
          >
            Acessar Edital
            <ExternalLink className="w-4 h-4" />
          </a>
          {bidding.latitude && bidding.longitude && (
            <button 
              onClick={() => onShowMap?.(bidding)}
              className="flex items-center justify-center gap-2 text-xs font-bold text-blue-600 hover:text-blue-700 transition-all py-2.5 px-4 bg-blue-50 rounded-xl border border-blue-100 hover:bg-blue-100 shadow-sm"
            >
              <MapIcon className="w-4 h-4" />
              Ver no Mapa
            </button>
          )}
          {bidding.date && (
            <p className="text-center text-[10px] text-slate-400 font-medium mt-1">
              Publicado em: {bidding.date}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
