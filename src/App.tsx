import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, Bell, Bike, Check, ChevronDown, CircleDollarSign, ClipboardList, CreditCard, Droplets, FileBarChart, Home, LayoutDashboard, LogOut, Menu, Milk, PackageCheck, Plus, QrCode, ReceiptText, RefreshCw, Search, Settings, ShieldCheck, Truck, UserRound, Users, Wallet, X, ScanLine, Sparkles, TrendingUp, MapPin, Clock3, CircleCheck, AlertCircle, CalendarDays, Send, Trash2 } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
type User = {
  id: number;
  name: string;
  email: string;
  role: 'super_admin' | 'delivery_boy' | 'customer' | 'supplier';
  customer_id?: number | null;
};
type Customer = {
  id: number;
  customer_code: string;
  name: string;
  phone: string;
  address: string;
  assigned_to?: number | null;
  active?: boolean;
  login_enabled?: boolean;
  created_at?: string;
  milk_type?: 'cow' | 'buffalo';
  quantity_litres?: number;
  morning_enabled?: boolean;
  evening_enabled?: boolean;
  due_count?: number;
};
type Delivery = {
  id: number;
  customer_id: number;
  customer_name: string;
  milk_type: 'cow' | 'buffalo';
  quantity_litres: number;
  rate_per_litre: number;
  amount: number;
  routine?: 'morning' | 'evening' | 'other';
  delivered_at: string;
  notes?: string;
};
type DeliveryBoy = {
  id: number;
  name: string;
  email: string;
  active: boolean;
  login_enabled: boolean;
};
type Supplier = { id: number; name: string; username: string | null; phone: string; list_name: string | null; login_enabled: boolean };
type Rate = {
  milk_type: string;
  rate_per_litre: number;
  effective_from: string;
};
type Bill = {
  customer_id: number;
  name: string;
  phone: string;
  billed: number;
  paid: number;
  balance: number;
};
type SupportTicketMessage = {
  id: number;
  sender_role: User['role'];
  sender_name: string;
  message: string;
  created_at: string;
};
type SupportTicket = {
  id: number;
  customer_name: string;
  customer_phone: string;
  recipient_name: string;
  recipient_type: 'owner' | 'delivery_boy';
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  messages: SupportTicketMessage[];
};
const API_BASE = String((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
let scannerLifecycle: Promise<void> = Promise.resolve();

async function releaseScanner(scanner: Html5Qrcode) {
  try {
    if (scanner.isScanning) await scanner.stop();
  } finally {
    scanner.clear();
  }
}

const api = async (path: string, token: string, init: RequestInit = {}) => {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? {
          Authorization: `Bearer ${token}`
        } : {}),
        ...((init.headers || {}) as Record<string, string>)
      }
    });
  } catch (cause) {
    const hint = API_BASE ? `Could not reach the API at ${API_BASE}. Check that the backend is running and that this URL is correct.` : 'Could not reach the Kakarla Dairy Farm API. Start both the Express backend and Vite frontend with `npm run dev`, and check that the backend is running on port 3000.';
    throw new Error(hint);
  }
  const contentType = r.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status}). Check the backend terminal for details.`);
  return data;
};
const money = (n: number | string | undefined) => `₹${Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;
const dateToday = () => new Date().toISOString().slice(0, 10);
const localDateKey = (value: string | Date) => {
  if (typeof value === 'string') return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
function Icon3D({
  children,
  tone = 'green'
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`icon3d icon3d--${tone}`}>{children}</span>;
}
function Brand() {
  return <div className="brand"><span className="brand-mark"><Milk size={25} /></span><span><b>Kakarla Dairy Farm</b><small>Freshness, delivered.</small></span></div>;
}
function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';
  disabled?: boolean;
}) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`btn btn-${variant}`}>{children}</button>;
}
function Field({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
function Metric({
  title,
  value,
  note,
  icon,
  tone = 'green'
}: {
  title: string;
  value: string;
  note: string;
  icon: ReactNode;
  tone?: string;
}) {
  return <article className="metric"><div className="metric-top"><span>{title}</span><Icon3D tone={tone}>{icon}</Icon3D></div><strong>{value}</strong><small>{note}</small></article>;
}
function Empty({
  label
}: {
  label: string;
}) {
  return <div className="empty"><PackageCheck size={30} /><b>{label}</b><span>Records will appear here after data is added.</span></div>;
}
function Scanner({
  onResult,
  onClose,
  onError,
  onOthers,
  onAssigned
}: {
  onResult: (v: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
  onOthers?: () => void;
  onAssigned?: () => void;
}) {
  const id = useId().replace(/:/g, '');
  const onResultRef = useRef(onResult);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  const scannerElementId = `milk-qr-reader-${id}`;
  const stopVideoTracks = () => {
    document.querySelectorAll(`#${scannerElementId} video`).forEach(video => {
      const stream = (video as HTMLVideoElement).srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    });
  };
  const closeScanner = () => {
    stopVideoTracks();
    onCloseRef.current();
  };
  onResultRef.current = onResult;
  onCloseRef.current = onClose;
  onErrorRef.current = onError;

  useEffect(() => {
    let disposed = false;
    let handledResult = false;
    let scanner: Html5Qrcode | null = null;
    let releasePromise: Promise<void> | null = null;
    const release = () => {
      if (!releasePromise) releasePromise = scanner ? releaseScanner(scanner) : Promise.resolve();
      return releasePromise;
    };
    const startTask = scannerLifecycle.then(async () => {
      if (disposed) return;
      scanner = new Html5Qrcode(scannerElementId, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
      });
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          decoded => {
            if (disposed || handledResult) return;
            handledResult = true;
            onResultRef.current(decoded);
          },
          () => {}
        );
        if (disposed) await release();
      } catch (error) {
        if (!disposed) onErrorRef.current(error instanceof Error ? error.message : 'Unable to start the camera scanner.');
        if (scanner) await release();
      }
    });
    scannerLifecycle = startTask.then(() => undefined, () => undefined);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeScanner();
    };
    const closeWhenHidden = () => {
      if (document.visibilityState === 'hidden') closeScanner();
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('visibilitychange', closeWhenHidden);

    return () => {
      disposed = true;
      stopVideoTracks();
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('visibilitychange', closeWhenHidden);
      scannerLifecycle = scannerLifecycle.then(async () => {
        if (scanner) await release();
      }).then(() => undefined, error => {
        onErrorRef.current(error instanceof Error ? error.message : 'Unable to stop the camera scanner.');
      });
    };
  }, [id, scannerElementId]);
  return <div className="scanner-overlay" onClick={closeScanner}><section className="scanner-card" onClick={event => event.stopPropagation()}><button className="close" onClick={closeScanner} aria-label="Close scanner"><X /></button><h2><ScanLine size={22} /> Scan customer QR</h2><p>Allow camera access and keep the QR code inside the frame.</p><div id={scannerElementId} /><div className="scanner-bottom-actions"><Button variant="secondary" onClick={() => { closeScanner(); (onOthers || onClose)(); }}>Others</Button><Button variant="secondary" onClick={() => { closeScanner(); (onAssigned || onClose)(); }}>Assigned customer list</Button></div><Button variant="secondary" onClick={closeScanner}>Close scanner</Button></section></div>;
}
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('milk_token') || '');
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState('Dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loginTab, setLoginTab] = useState('bill');
  const [selectedHistoryDate, setSelectedHistoryDate] = useState('');
  const [selectedDeliveryRoutine, setSelectedDeliveryRoutine] = useState<'morning' | 'evening'>('morning');
  const [messageText, setMessageText] = useState('');
  const [notificationRecipientType, setNotificationRecipientType] = useState<'all_customers' | 'customer' | 'delivery_boy'>('all_customers');
  const [notificationRecipientId, setNotificationRecipientId] = useState('');
  const [refreshStart, setRefreshStart] = useState<number | null>(null);
  const [selectedMonthDate, setSelectedMonthDate] = useState(new Date());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [boys, setBoys] = useState<DeliveryBoy[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierProfile, setSupplierProfile] = useState<Supplier | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [reportSummary, setReportSummary] = useState<any>({});
  const [overview, setOverview] = useState<any>({});
  const [payments, setPayments] = useState<any[]>([]);
  const [billing, setBilling] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedBoy, setSelectedBoy] = useState<DeliveryBoy | null>(null);
  const [driverToSetupLogin, setDriverToSetupLogin] = useState<DeliveryBoy | null>(null);
  const [customerToSetupLogin, setCustomerToSetupLogin] = useState<Customer | null>(null);
  const [qrData, setQrData] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [deliveryPreview, setDeliveryPreview] = useState<any>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    email: '',
    password: '',
    assigned_to: '',
    milk_type: 'cow',
    quantity_litres: '1',
    morning_enabled: true,
    evening_enabled: false
  });
  const [boyForm, setBoyForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: ''
  });
  const [boyLoginForm, setBoyLoginForm] = useState({
    email: '',
    password: ''
  });
  const [customerLoginPassword, setCustomerLoginPassword] = useState('');
  const [supplierToChangePassword, setSupplierToChangePassword] = useState<Supplier | null>(null);
  const [supplierPassword, setSupplierPassword] = useState('');
  const [ticketRecipientType, setTicketRecipientType] = useState<'owner' | 'delivery_boy'>('owner');
  const [deliveryForm, setDeliveryForm] = useState({
    customer_id: '',
    milk_type: 'cow',
    quantity_litres: '1',
    routine: 'morning',
    notes: ''
  });
  const [paymentForm, setPaymentForm] = useState({
    customer_id: '',
    amount: '',
    payment_method: 'cash',
    reference_note: ''
  });
  const [rateForm, setRateForm] = useState({
    milk_type: 'cow',
    rate_per_litre: '60',
    effective_from: dateToday()
  });
  const [temporaryDelivery, setTemporaryDelivery] = useState({ phone: '', milk_type: 'cow', quantity_litres: '1', routine: 'other' });
  const role = user?.role;
  const isOwner = role === 'super_admin';
  const isDelivery = role === 'delivery_boy';
  const isCustomer = role === 'customer';
  const isSupplier = role === 'supplier';
  const activeBoys = boys.filter(boy => boy.active);
  const nav = useMemo(() => isOwner ? [['Dashboard', <LayoutDashboard />], ['Customers', <Users />], ['Delivery Boys', <Bike />], ['Suppliers', <Milk />], ['Assignments', <ShieldCheck />], ['Deliveries', <PackageCheck />], ['Milk Pricing', <Milk />], ['Payments', <Wallet />], ['Monthly Billing', <ReceiptText />], ['Reports', <FileBarChart />], ['Notifications', <Bell />], ['Profile', <UserRound />]] : isDelivery ? [['Dashboard', <Home />], ['My Customers', <Users />], ['Scanner', <ScanLine />], ['Collect Payment', <CreditCard />], ['Notifications', <Bell />], ['Profile', <UserRound />]] : isSupplier ? [['Dashboard', <Home />], ['Profile', <UserRound />]] : [['Dashboard', <Home />], ['Delivery History', <PackageCheck />], ['Bills & Payments', <ReceiptText />], ['My QR Code', <QrCode />], ['Notifications', <Bell />], ['Profile', <UserRound />]], [role]);
  const load = async (t = token, u = user) => {
    if (!t || !u) return;
    setLoading(true);
    setError('');
    try {
      if (u.role === 'super_admin') {
        const [d, c, del, b, s, r, rep, p, n, tickets] = await Promise.all([api('/dashboard', t), api('/customers', t), api('/deliveries', t), api('/delivery-boys', t), api('/suppliers', t), api('/rates', t), api(`/reports/monthly?month=${month}`, t), api('/payments', t), api('/notifications', t), api('/support-tickets', t)]);
        setOverview(d);
        setCustomers(c);
        setDeliveries(del);
        setBoys(b);
        setSuppliers(s);
        setRates(r);
        setBills(rep.rows || []);
        setReportSummary(rep.summary || {});
        setPayments(p);
        setNotifications(n);
        setSupportTickets(tickets);
      } else if (u.role === 'delivery_boy') {
        const [d, c, del, r, p, n, tickets] = await Promise.all([api('/delivery/overview', t), api('/delivery/customers', t), api('/delivery/deliveries', t), api('/rates', t), api('/payments', t), api('/delivery/notifications', t), api('/support-tickets', t)]);
        setOverview(d);
        setCustomers(c);
        setDeliveries(del);
        setRates(r);
        setPayments(p);
        setNotifications(n);
        setSupportTickets(tickets);
      } else if (u.role === 'supplier') {
        setSupplierProfile(await api('/supplier/profile', t));
      } else {
        const [d, del, p, qr, n, b, tickets] = await Promise.all([api('/customer/summary', t), api('/customer/deliveries', t), api('/customer/payments', t), api('/customer/qr', t), api('/customer/notifications', t), api('/customer/billing', t), api('/support-tickets', t)]);
        setOverview(d);
        setDeliveries(del);
        setPayments(p);
        setBilling(b);
        setQrData(qr.dataUrl || '');
        setNotifications(n);
        setSupportTickets(tickets);
      }
    } catch (e: any) {
      setError(e.message || 'Could not load data');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const d = await api('/auth/me', token);
        if (!alive) return;
        setUser(d.user);
        if (d.user.role === 'customer') setPage('My QR Code');
        await load(token, d.user);
      } catch {
        localStorage.removeItem('milk_token');
        setToken('');
        setUser(null);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (user && token) load(token, user);
  }, [month]);
  useEffect(() => {
    if (!user || !token) return;
    const interval = window.setInterval(() => load(token, user), 12 * 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [token, user, month]);
  useEffect(() => {
    let startY: number | null = null;
    const start = (event: TouchEvent) => {
      if (window.scrollY === 0) startY = event.touches[0]?.clientY ?? null;
    };
    const end = (event: TouchEvent) => {
      const endY = event.changedTouches[0]?.clientY;
      if (startY !== null && endY !== undefined && endY - startY > 90 && window.scrollY === 0) load();
      startY = null;
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchend', end);
    };
  }, [token, user, month]);
  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const d = await api('/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({
          email: loginPhone,
          phone: loginPhone,
          password: loginPassword
        })
      });
      localStorage.setItem('milk_token', d.token);
      setToken(d.token);
      setUser(d.user);
      setPage(d.user.role === 'customer' ? 'My QR Code' : 'Dashboard');
      await load(d.token, d.user);
      setSuccess(`Welcome, ${d.user.name}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setBooting(false);
    }
  };
  const requestPasswordReset = async () => {
    setError('');
    setLoading(true);
    try {
      await api('/auth/password-reset/request', '', {
        method: 'POST',
        body: JSON.stringify({ phone: loginPhone })
      });
      setResetCodeSent(true);
      setSuccess('If an active account matches that phone number, a reset code will be sent.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const confirmPasswordReset = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api('/auth/password-reset/confirm', '', {
        method: 'POST',
        body: JSON.stringify({ phone: loginPhone, otp: resetCode, password: newPassword })
      });
      setSuccess(result.message);
      setResetMode(false);
      setResetCodeSent(false);
      setResetCode('');
      setNewPassword('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const signOut = () => {
    localStorage.removeItem('milk_token');
    setToken('');
    setUser(null);
    setCustomers([]);
    setSuppliers([]);
    setSupplierProfile(null);
    setDeliveries([]);
    setPage('Dashboard');
    setError('');
    setSuccess('');
  };
  const refresh = () => load();
  const saveSupplierPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!supplierToChangePassword) return;
    try {
      await api(`/suppliers/${supplierToChangePassword.id}/password`, token, { method: 'PUT', body: JSON.stringify({ password: supplierPassword }) });
      setSuppliers(current => current.map(supplier => supplier.id === supplierToChangePassword.id ? { ...supplier, login_enabled: true } : supplier));
      setModal('');
      setSupplierToChangePassword(null);
      setSupplierPassword('');
      flash(`Login password updated for ${supplierToChangePassword.name}`);
    } catch (e: any) {
      setError(e.message || 'Could not update supplier password');
    }
  };
  const closeCustomerQr = () => setPage('Dashboard');
  const flash = (message: string) => {
    setSuccess(message);
    setError('');
    setTimeout(() => setSuccess(''), 4000);
  };
  const saveCustomer = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = {
        ...customerForm,
        phone: customerForm.phone.replace(/\D/g, ''),
        assigned_to: customerForm.assigned_to ? Number(customerForm.assigned_to) : null
      };
      const d = await api(isDelivery ? '/delivery/customers' : '/customers', token, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setModal('');
      setCustomerForm({
        name: '',
        phone: '',
        address: '',
        email: '',
        password: '',
        assigned_to: '',
        milk_type: 'cow',
        quantity_litres: '1',
        morning_enabled: true,
        evening_enabled: false
      });
      await load();
      flash(`Customer ${d.name || 'created'} successfully`);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveBoy = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/delivery-boys', token, {
        method: 'POST',
        body: JSON.stringify(boyForm)
      });
      setModal('');
      setBoyForm({
        name: '',
        email: '',
        phone: '',
        password: ''
      });
      await load();
      flash('Delivery boy account created');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveBoyLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!driverToSetupLogin) return;
    const changingPassword = driverToSetupLogin.login_enabled;
    const driverName = driverToSetupLogin.name;
    try {
      await api(`/delivery-boys/${driverToSetupLogin.id}/login`, token, {
        method: 'PUT',
        body: JSON.stringify(boyLoginForm)
      });
      setModal('');
      setDriverToSetupLogin(null);
      setBoyLoginForm({ email: '', password: '' });
      await load();
      flash(changingPassword ? `Password updated for ${driverName}` : `Delivery partner login set up for ${driverName}`);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveCustomerLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerToSetupLogin) return;
    const changingPassword = customerToSetupLogin.login_enabled;
    const customerName = customerToSetupLogin.name;
    const customerPhone = customerToSetupLogin.phone;
    try {
      await api(`/customers/${customerToSetupLogin.id}/login`, token, {
        method: 'PUT',
        body: JSON.stringify({ password: customerLoginPassword })
      });
      setModal('');
      setCustomerToSetupLogin(null);
      setCustomerLoginPassword('');
      await load();
      flash(changingPassword ? `Password updated for ${customerName}` : `Login set up for ${customerName}. Username: ${customerPhone}`);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const assign = async (customerId: number, boyId: string) => {
    try {
      await api(`/customers/${customerId}/assignment`, token, {
        method: 'PUT',
        body: JSON.stringify({
          delivery_boy_id: boyId ? Number(boyId) : null
        })
      });
      await load();
      flash('Assignment updated');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const deleteCustomer = async (customer: Customer) => {
    if (!window.confirm(`Remove ${customer.name} from active customers? Their delivery and payment history will be preserved.`)) return;
    try {
      await api(`/customers/${customer.id}`, token, { method: 'DELETE' });
      await load();
      flash(`${customer.name} was removed from active customers`);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const deleteDeliveryBoy = async (boy: DeliveryBoy) => {
    if (!window.confirm(`Deactivate ${boy.name}? They will lose access and their assigned customers will become unassigned. Delivery history will be preserved.`)) return;
    try {
      await api(`/delivery-boys/${boy.id}`, token, { method: 'DELETE' });
      if (selectedBoy?.id === boy.id) setSelectedBoy(null);
      await load();
      flash(`${boy.name} was deactivated and their customers were unassigned`);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const beginScan = async (code: string) => {
    setShowScanner(false);
    try {
      const clean = code.trim();
      let customer: any;
      if (clean.startsWith('{')) {
        const parsed = JSON.parse(clean);
        customer = await api(`/qr/${encodeURIComponent(parsed.customerCode || parsed.customer_code)}`, token);
      } else customer = await api(`/qr/${encodeURIComponent(clean)}`, token);
      setSelectedCustomer(customer);
      setDeliveryForm({
        customer_id: String(customer.id),
        milk_type: customer.milk_type || 'cow',
        quantity_litres: String(customer.quantity_litres || '1'),
        routine: selectedDeliveryRoutine === 'morning' && customer.morning_enabled
          ? 'morning'
          : selectedDeliveryRoutine === 'evening' && customer.evening_enabled
            ? 'evening'
            : customer.morning_enabled
              ? 'morning'
              : customer.evening_enabled
                ? 'evening'
                : 'other',
        notes: ''
      });
      setShowScanner(false);
      setScanCode('');
      setModal('');
      setModal('delivery');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const selectDeliveryCustomer = (customerId: string) => {
    const customer = customers.find(candidate => String(candidate.id) === customerId);
    setDeliveryForm(current => ({
      ...current,
      customer_id: customerId,
      ...(customer ? {
        milk_type: customer.milk_type || 'cow',
        quantity_litres: String(customer.quantity_litres || 1),
        routine: selectedDeliveryRoutine === 'morning' && customer.morning_enabled
          ? 'morning'
          : selectedDeliveryRoutine === 'evening' && customer.evening_enabled
            ? 'evening'
            : customer.morning_enabled
              ? 'morning'
              : customer.evening_enabled
                ? 'evening'
                : 'other'
      } : {})
    }));
    setSelectedCustomer(customer || null);
  };
  const previewDelivery = async (e: FormEvent) => {
    e.preventDefault();
    const rate = Number(rates.find(r => r.milk_type === deliveryForm.milk_type)?.rate_per_litre || 0);
    const quantity = Number(deliveryForm.quantity_litres);
    if (!deliveryForm.customer_id || quantity <= 0) {
      setError('Select a customer and enter a valid quantity');
      return;
    }
    setDeliveryPreview({
      ...deliveryForm,
      rate,
      amount: rate * quantity,
      customer: customers.find(c => String(c.id) === deliveryForm.customer_id) || selectedCustomer
    });
    setModal('confirm-delivery');
  };
  const confirmDelivery = async () => {
    try {
      await api(isDelivery ? '/delivery/complete' : '/deliveries', token, {
        method: 'POST',
        body: JSON.stringify({
          customer_id: Number(deliveryPreview.customer_id),
          milk_type: deliveryPreview.milk_type,
          quantity_litres: Number(deliveryPreview.quantity_litres),
          routine: deliveryPreview.routine,
          notes: deliveryPreview.notes
        })
      });
      setModal('');
      setDeliveryPreview(null);
      setSelectedCustomer(null);
      await load();
      flash('Delivery saved successfully. Customer account updated.');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const savePayment = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/payments', token, {
        method: 'POST',
        body: JSON.stringify({
          ...paymentForm,
          customer_id: Number(paymentForm.customer_id),
          amount: Number(paymentForm.amount)
        })
      });
      setModal('');
      setPaymentForm({
        customer_id: '',
        amount: '',
        payment_method: 'cash',
        reference_note: ''
      });
      await load();
      flash('Payment recorded successfully');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveTemporaryDelivery = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/delivery/temporary', token, {
        method: 'POST',
        body: JSON.stringify({
          ...temporaryDelivery,
          quantity_litres: Number(temporaryDelivery.quantity_litres),
          phone: temporaryDelivery.phone.replace(/\D/g, '')
        })
      });
      setModal('');
      setTemporaryDelivery({ phone: '', milk_type: 'cow', quantity_litres: '1', routine: 'other' });
      await load();
      flash('Temporary delivery recorded');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveRate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/rates', token, {
        method: 'PUT',
        body: JSON.stringify({
          ...rateForm,
          rate_per_litre: Number(rateForm.rate_per_litre)
        })
      });
      await load();
      setModal('');
      flash('Milk rate updated');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const openQr = async (c: Customer) => {
    try {
      const d = await api(isCustomer ? '/customer/qr' : isDelivery ? `/delivery/customers/${c.id}/qr` : `/customers/${c.id}/qr`, token);
      setQrData(d.dataUrl);
      setSelectedCustomer(c);
      setModal('qr');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const deleteNotification = async (notification: any) => {
    try {
      await api(isCustomer ? `/customer/notifications/${notification.id}` : isDelivery ? `/delivery/notifications/${notification.id}` : `/notifications/${notification.id}`, token, { method: 'DELETE' });
      setNotifications(current => current.filter(item => item.id !== notification.id));
      flash('Notification deleted');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const sendNotification = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(isCustomer ? '/customer/support-tickets' : '/notifications', token, {
        method: 'POST',
        body: JSON.stringify({
          message: messageText,
          recipient_type: isCustomer ? ticketRecipientType : notificationRecipientType,
          ...(notificationRecipientType === 'customer' ? { customer_id: Number(notificationRecipientId) } : {}),
          ...(notificationRecipientType === 'delivery_boy' ? { delivery_boy_id: Number(notificationRecipientId) } : {})
        })
      });
      setMessageText('');
      await load();
      const recipientLabel = notificationRecipientType === 'delivery_boy'
        ? 'delivery partner'
        : notificationRecipientType === 'customer'
          ? 'customer'
          : 'all active customers';
      flash(isCustomer ? `Support ticket sent to ${ticketRecipientType === 'owner' ? 'the owner' : 'your delivery partner'}` : `Notification sent to ${recipientLabel}`);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const replyToTicket = async (ticketId: number, message: string) => {
    try {
      await api(`/support-tickets/${ticketId}/messages`, token, {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      await load();
      flash('Reply added to support ticket');
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };
  const setTicketStatus = async (ticketId: number, status: 'open' | 'closed') => {
    try {
      await api(`/support-tickets/${ticketId}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await load();
      flash(`Support ticket ${status}`);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const filtered = customers.filter(c => `${c.name} ${c.phone} ${c.address} ${c.customer_code}`.toLowerCase().includes(search.toLowerCase()));
  const todayKey = localDateKey(new Date());
  const deliveredCustomerIdsForRoutine = new Set(deliveries
    .filter(delivery => localDateKey(delivery.delivered_at) === todayKey && delivery.routine === selectedDeliveryRoutine)
    .map(delivery => Number(delivery.customer_id)));
  const scheduledCustomers = customers.filter(customer => customer[`${selectedDeliveryRoutine}_enabled`]);
  const remainingScheduledCustomers = scheduledCustomers.filter(customer => !deliveredCustomerIdsForRoutine.has(Number(customer.id)));
  const completedScheduledCount = scheduledCustomers.length - remainingScheduledCustomers.length;
  const title = page === 'Dashboard' ? isOwner ? 'Owner dashboard' : isDelivery ? 'My route' : isSupplier ? 'Supplier dashboard' : 'My dairy account' : page;
  const currentDateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  if (booting) return <div className="loading-screen"><Brand /><div className="loader" /><span>Preparing your workspace…</span></div>;
  if (!user) return <LoginPanel phone={loginPhone} setPhone={setLoginPhone} password={loginPassword} setPassword={setLoginPassword} loading={loading} error={error} success={success} resetMode={resetMode} setResetMode={setResetMode} resetCodeSent={resetCodeSent} code={resetCode} setCode={setResetCode} newPassword={newPassword} setNewPassword={setNewPassword} onSignIn={signIn} onRequestReset={requestPasswordReset} onConfirmReset={confirmPasswordReset} />;
  const menuClick = (p: string) => {
    setShowScanner(false);
    setPage(p);
    setMobileNav(false);
    setError('');
  };
  const openCustomerForm = () => {
    setCustomerForm({
      name: '',
      phone: '',
      address: '',
      email: '',
      password: '',
      assigned_to: '',
      milk_type: 'cow',
      quantity_litres: '1',
      morning_enabled: true,
      evening_enabled: false
    });
    setModal('customer');
  };
  return <div className="app-shell"><aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><Brand /><div className="workspace"><span className="workspace-logo">{isDelivery ? 'DB' : isSupplier ? 'SP' : 'KD'}</span><span><b>{isOwner ? 'Kakarla Dairy Farm' : isDelivery ? 'Delivery workspace' : isSupplier ? 'Supplier workspace' : 'My Kakarla Dairy Farm'}</b><small>{isOwner ? 'Business workspace' : isDelivery ? 'Assigned route' : isSupplier ? 'Supplier account' : 'Customer account'}</small></span><ChevronDown size={16} /></div><div className="nav-label">WORKSPACE</div><nav>{nav.map(([name, icon]) => <button key={String(name)} onClick={() => menuClick(String(name))} className={`nav-item ${page === name ? 'active' : ''}`}>{icon}<span>{name}</span>{name === 'Notifications' && <i className="nav-dot" />}</button>)}</nav><div className="sidebar-bottom"><div className="avatar">{user.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</div><div className="profile-name"><b>{user.name}</b><small>{roleLabel(user.role)}</small></div><button className="icon-btn" onClick={signOut} title="Sign out"><LogOut size={17} /></button></div></aside>
 {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
 <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="mobile-menu" aria-label={mobileNav ? 'Close menu' : 'Open menu'} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X /> : <Menu />}</button><div><div className="breadcrumb">Kakarla Dairy Farm <span>/</span> {title}</div><h1>{title}</h1><p>{isOwner ? 'Your dairy operations at a glance.' : isDelivery ? 'Your assigned customers and today’s delivery progress.' : isSupplier ? 'Your supplier account and assigned collection list.' : 'Your milk deliveries, bills and payments.'}</p></div></div><div className="top-actions"><button className="icon-btn" onClick={refresh} title="Refresh"><RefreshCw size={18} /></button><button className="icon-btn notification-btn" onClick={() => menuClick('Notifications')} title="Notifications"><Bell size={19} /><i /></button><button className="top-avatar top-avatar-button" onClick={() => menuClick('Profile')} title="Profile" aria-label="Open profile">{user.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</button></div></header>
 {error && <div className="alert alert-error"><AlertCircle size={17} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}{success && <div className="alert alert-success"><CircleCheck size={17} />{success}<button onClick={() => setSuccess('')}><X size={15} /></button></div>}{loading && <div className="thin-progress" />}
 {page === 'Dashboard' && <div className="current-date"><CalendarDays size={16} />{currentDateLabel}</div>}
 {page === 'Dashboard' && isDelivery && <section className="metrics-grid delivery-metrics-replacement">
   <Metric title="Houses completed" value={`${overview.completed_today ?? 0} / ${overview.assigned_customers ?? customers.length}`} note="Distinct assigned homes served today" icon={<PackageCheck />} tone="mint" />
   <Metric title="Scheduled routines" value={String(overview.scheduled_routines ?? 0)} note="Morning and evening rounds" icon={<Clock3 />} tone="blue" />
   <Metric title="Litres delivered" value={`${Number(overview.litres_today || 0).toFixed(1)} L`} note="Today's total" icon={<Droplets />} tone="amber" />
 </section>}
 {page === 'Dashboard' && <>
 {isOwner && <><section className="welcome-banner owner-dashboard-hero"><div><span className="eyebrow"><Sparkles size={14} /> TODAY’S OPERATIONS</span><h2>Good day, {user.name.split(' ')[0]}.</h2><p>Keep your dairy running smoothly. Here’s what’s happening today.</p><div className="owner-hero-actions"><Button variant="light" onClick={openCustomerForm}><Plus size={16} /> Add customer</Button><Button variant="light" onClick={() => menuClick('Deliveries')}>View deliveries <ArrowRight size={16} /></Button></div></div><div className="banner-art"><div className="milk-bottle"><i /><b>FRESH<br />MILK</b></div><div className="banner-leaf leaf-a" /><div className="banner-leaf leaf-b" /></div></section><section className="metrics-grid owner-metrics-replacement"><Metric title="Active customers" value={String(overview.customers ?? customers.length)} note="Customer accounts" icon={<Users />} /><Metric title="Earnings today" value={money(overview.earnings)} note="Payments received today" icon={<Wallet />} tone="mint" /><Metric title="Houses completed" value={`${overview.completed_houses ?? 0} / ${overview.customers ?? customers.length}`} note="Distinct homes served today" icon={<PackageCheck />} tone="blue" /><Metric title="Scheduled routines" value={String(overview.scheduled_routines ?? 0)} note="Morning and evening rounds" icon={<Clock3 />} tone="amber" /></section><div className="content-grid"><section className="panel"><PanelHead title="Recent deliveries" subtitle="Latest delivery records from your team" action={<Button variant="ghost" onClick={() => menuClick('Deliveries')}>View all <ArrowRight size={15} /></Button>} /><DeliveryTable rows={deliveries.slice(0, 6)} /></section><section className="panel quick-panel"><PanelHead title="Quick actions" subtitle="Common tasks in one place" /><QuickAction icon={<Users />} title="Add a customer" desc="Create a customer profile" onClick={openCustomerForm} /><QuickAction icon={<Bike />} title="Add delivery boy" desc="Create a delivery login" onClick={() => setModal('boy')} /><QuickAction icon={<Milk />} title="Update milk rates" desc="Set current per-litre prices" onClick={() => setModal('rate')} /><div className="note-box"><b>Daily close-out</b><p>Review delivered litres, collected payments and pending balances before the end of the day.</p></div></section></div></>}
 {isDelivery && <><section className="welcome-banner delivery-banner"><div><span className="eyebrow"><Truck size={14} /> YOUR DELIVERY ROUTE</span><h2>Ready for today, {user.name.split(' ')[0]}?</h2><p>Track customers still waiting for milk in each delivery schedule. Open My Customers for full customer details and delivery actions.</p><Button variant="light" onClick={() => menuClick('My Customers')}><Users size={16} /> Open My Customers</Button></div><div className="banner-art"><Icon3D tone="mint"><Bike size={60} /></Icon3D></div></section><section className="metrics-grid"><Metric title="Assigned customers" value={String(customers.length)} note="Your current route" icon={<Users />} /><Metric title="Completed today" value={String(overview.completed_today || 0)} note="Saved deliveries" icon={<Check />} tone="mint" /><Metric title="Pending today" value={String(overview.pending_today || customers.length)} note="Customers not yet served" icon={<Clock3 />} tone="amber" /><Metric title="Litres delivered" value={`${Number(overview.litres_today || 0).toFixed(1)} L`} note="Today's total" icon={<Droplets />} tone="blue" /></section><section className="panel schedule-panel"><PanelHead title="Remaining for this schedule" subtitle="Customers are removed from this list after a delivery is recorded for the selected schedule today." action={<Button onClick={() => { setScanCode(''); setShowScanner(true); }}><ScanLine size={16} /> Scan QR</Button>} /><div className="schedule-tabs" role="tablist" aria-label="Delivery schedule"><button type="button" role="tab" aria-selected={selectedDeliveryRoutine === 'morning'} className={selectedDeliveryRoutine === 'morning' ? 'active' : ''} onClick={() => setSelectedDeliveryRoutine('morning')}>Morning</button><button type="button" role="tab" aria-selected={selectedDeliveryRoutine === 'evening'} className={selectedDeliveryRoutine === 'evening' ? 'active' : ''} onClick={() => setSelectedDeliveryRoutine('evening')}>Evening</button></div><div className="schedule-progress"><b>{completedScheduledCount} of {scheduledCustomers.length} completed</b><span>{remainingScheduledCustomers.length} remaining</span></div>{remainingScheduledCustomers.length ? <div className="schedule-customer-list">{remainingScheduledCustomers.map(customer => <article className="schedule-customer" key={customer.id}><span className="schedule-customer-avatar">{initials(customer.name)}</span><div><b>{customer.name}</b><small>{customer.phone || 'No phone'}{customer.address ? ` · ${customer.address}` : ''}</small></div><span className="schedule-waiting">Waiting</span></article>)}</div> : <div className="schedule-empty"><CircleCheck size={24} /><b>{scheduledCustomers.length ? 'All scheduled customers are served' : `No customers scheduled for ${selectedDeliveryRoutine}`}</b><span>{scheduledCustomers.length ? 'There are no remaining deliveries for this schedule today.' : 'Add or update customer routines from My Customers.'}</span></div>}</section></>}
 {isCustomer && <><section className="customer-hero"><div><span className="eyebrow"><Sparkles size={14} /> YOUR MILKMATE ACCOUNT</span><h2>Good to see you, {user.name.split(' ')[0]}.</h2><p>Your deliveries and monthly account, all in one place.</p><Button variant="light" onClick={() => menuClick('My QR Code')}><QrCode size={16} /> Show my QR code</Button></div><div className="qr-mini">{qrData ? <img src={qrData} alt="Customer QR code" /> : <QrCode size={75} />}<small>YOUR DELIVERY QR</small></div></section><section className="metrics-grid"><Metric title="Month-to-date bill" value={money(overview.summary?.total)} note={`${Number(overview.summary?.litres || 0).toFixed(1)} litres delivered`} icon={<ReceiptText />} /><Metric title="Payments received" value={money(overview.summary?.paid)} note="This billing period" icon={<Wallet />} tone="mint" /><Metric title="Outstanding balance" value={money(overview.summary?.balance)} note="Current balance" icon={<CircleDollarSign />} tone="amber" /><Metric title="Deliveries this month" value={String(overview.summary?.delivery_count || 0)} note="Successfully saved deliveries" icon={<PackageCheck />} tone="blue" /></section><section className="panel"><PanelHead title="Recent deliveries" subtitle="Your personal delivery history" action={<Button variant="ghost" onClick={() => menuClick('Delivery History')}>Full history <ArrowRight size={15} /></Button>} /><DeliveryTable rows={deliveries.slice(0, 8)} /></section></>}
 </>}
 {page === 'Dashboard' && isSupplier && <section className="panel supplier-dashboard"><PanelHead title={supplierProfile?.list_name || 'Supplier account'} subtitle="Your supplier sign-in is connected to Kakarla Dairy Farm." /><div className="metrics-grid metrics-grid--compact"><Metric title="Supplier" value={supplierProfile?.name || user.name} note="Registered supplier" icon={<UserRound />} /><Metric title="Assigned list" value={supplierProfile?.list_name || 'Not assigned'} note="Your collection list" icon={<ClipboardList />} tone="mint" /><Metric title="Contact" value={supplierProfile?.phone || '—'} note={supplierProfile?.username ? `Username: ${supplierProfile.username}` : 'Contact the dairy owner'} icon={<Milk />} tone="blue" /></div></section>}
 {page === 'Suppliers' && isOwner && <section className="panel"><PanelHead title="Suppliers" subtitle={`${suppliers.length} supplier accounts from the existing records`} /><div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Phone</th><th>Collection list</th><th>Username</th><th>Login</th><th className="table-actions-heading">Actions</th></tr></thead><tbody>{suppliers.map(supplier => <tr key={supplier.id}><td><b>{supplier.name}</b></td><td>{supplier.phone}</td><td>{supplier.list_name || '—'}</td><td><code>{supplier.username || 'Not set'}</code></td><td><span className={`status ${supplier.login_enabled ? 'status-ok' : ''}`}>{supplier.login_enabled ? 'Enabled' : 'Password required'}</span></td><td><div className="table-row-actions"><Button variant="secondary" disabled={!supplier.username} onClick={() => { setSupplierToChangePassword(supplier); setSupplierPassword(''); setModal('supplier-password'); }}>{supplier.login_enabled ? 'Change password' : 'Set password'}</Button></div></td></tr>)}</tbody></table>{!suppliers.length && <Empty label="No supplier records yet" />}</div></section>}
 {page === 'Customers' && isOwner && <section className="panel"><PanelHead title="Customer management" subtitle={`${customers.length} active customer records`} action={<Button onClick={openCustomerForm}><Plus size={16} /> Add customer</Button>} /><Toolbar search={search} setSearch={setSearch} placeholder="Search name, phone or customer code" /><CustomerTable rows={filtered} onQr={openQr} onDeliver={c => {
          setSelectedCustomer(c);
          setDeliveryForm({
            customer_id: String(c.id),
            milk_type: c.milk_type || 'cow',
            quantity_litres: String(c.quantity_litres || '1'),
            routine: c.morning_enabled ? 'morning' : c.evening_enabled ? 'evening' : 'other',
            notes: ''
          });
          setModal('delivery');
        }} showAssignment boys={activeBoys} onAssign={assign} onDelete={deleteCustomer} showLoginManagement onManageLogin={customer => {
          setCustomerToSetupLogin(customer);
          setCustomerLoginPassword('');
          setModal('customer-login');
        }} /></section>}
 {page === 'My Customers' && isDelivery && <section className="panel"><PanelHead title="My assigned customers" subtitle="View customer codes, QR codes, and delivery actions for your route" action={<Button onClick={() => setModal('customer')}><Plus size={16} /> Add customer</Button>} /><Toolbar search={search} setSearch={setSearch} placeholder="Search your customers" /><CustomerTable rows={filtered} onQr={openQr} onDeliver={c => {
          selectDeliveryCustomer(String(c.id));
          setModal('delivery');
        }} /></section>}
 {page === 'Scanner' && isDelivery && <section className="panel scanner-page"><PanelHead title="Delivery scanner" subtitle="Scan an assigned customer QR or record a one-time delivery." /><Button onClick={() => setShowScanner(true)}><ScanLine size={17} /> Open scanner</Button><div className="scanner-bottom-actions"><Button variant="secondary" onClick={() => setModal('temporary')}>Others</Button><Button variant="secondary" onClick={() => menuClick('My Customers')}>Assigned customer list</Button></div></section>}
 {page === 'Delivery Boys' && isOwner && <section className="panel"><PanelHead title="Delivery team" subtitle="Select a delivery partner to view their assigned customers" action={<Button onClick={() => setModal('boy')}><Plus size={16} /> Add delivery boy</Button>} /><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Assigned customers</th><th className="table-actions-heading">Actions</th></tr></thead><tbody>{boys.map(b => <tr key={b.id}><td><div className="person"><span className="avatar">{initials(b.name)}</span><button className="text-button" onClick={() => setSelectedBoy(b)}>{b.name}</button></div></td><td>{b.email || '—'}</td><td><span className={`status ${b.active && b.login_enabled ? 'status-ok' : ''}`}>{!b.active ? 'Inactive' : b.login_enabled ? 'Active' : 'Login not set up'}</span></td><td><button className="table-action" onClick={() => setSelectedBoy(b)}>{customers.filter(c => Number(c.assigned_to) === b.id).length} customers</button></td><td><div className="table-row-actions">{b.active && <Button variant="secondary" onClick={() => { setDriverToSetupLogin(b); setBoyLoginForm({ email: b.email || '', password: '' }); setModal('boy-login'); }}>{b.login_enabled ? 'Change password' : 'Set up login'}</Button>}{b.active ? <Button variant="danger" onClick={() => deleteDeliveryBoy(b)}><Trash2 size={15} /> Delete</Button> : '—'}</div></td></tr>)}</tbody></table>{!boys.length && <Empty label="No delivery accounts yet" />}</div></section>}
 {page === 'Assignments' && isOwner && <section className="panel"><PanelHead title="Customer assignments" subtitle="Assign or reassign customers to delivery partners" /><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Address</th><th>Current delivery partner</th><th>Update assignment</th></tr></thead><tbody>{customers.map(c => <tr key={c.id}><td><b>{c.name}</b><small>{c.customer_code}</small></td><td>{c.address || '—'}</td><td>{boys.find(b => b.id === Number(c.assigned_to))?.name || 'Unassigned'}</td><td><select value={c.assigned_to || ''} onChange={e => assign(c.id, e.target.value)}><option value="">Unassigned</option>{activeBoys.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td></tr>)}</tbody></table></div></section>}
 {page === 'Deliveries' && isOwner && <section className="panel"><PanelHead title="Delivery records" subtitle="Confirmed deliveries saved to MySQL" action={<Button variant="secondary" onClick={refresh}><RefreshCw size={15} /> Refresh</Button>} /><Toolbar search={search} setSearch={setSearch} placeholder="Search delivery records" /><DeliveryTable rows={deliveries.filter(d => `${d.customer_name} ${d.milk_type}`.toLowerCase().includes(search.toLowerCase()))} /></section>}
 {page === 'Record Delivery' && isDelivery && <section className="panel form-panel"><PanelHead title="Record a delivery" subtitle="Scan a QR code or select one of your assigned customers" /><div className="form-content"><Button onClick={() => setModal('scan')}><ScanLine size={16} /> Scan customer QR</Button><Field label="Assigned customer"><select value={deliveryForm.customer_id} onChange={e => selectDeliveryCustomer(e.target.value)}><option value="">Choose customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.customer_code}</option>)}</select></Field><Button variant="secondary" onClick={() => setModal('delivery')}>Enter delivery details <ArrowRight size={16} /></Button></div></section>}
 {page === 'Milk Pricing' && isOwner && <section className="panel"><PanelHead title="Milk types & pricing" subtitle="Rates are applied when a delivery is recorded" action={<Button onClick={() => setModal('rate')}><Plus size={16} /> Update rate</Button>} /><div className="rate-grid">{rates.map(r => <article className="rate-card" key={r.milk_type}><Icon3D>{<Milk size={25} />}</Icon3D><span>{r.milk_type === 'cow' ? 'Cow milk' : 'Buffalo milk'}</span><strong>{money(r.rate_per_litre)}<small>/ litre</small></strong><small>Effective {String(r.effective_from).slice(0, 10)}</small></article>)}</div></section>}
 {page === 'Payments' && <section className="panel"><PanelHead title={isCustomer ? 'My payment history' : 'Payment collection'} subtitle={isCustomer ? 'Payments recorded against your account' : 'Record cash, UPI or bank collections'} action={!isCustomer ? <Button onClick={() => setModal('payment')}><Plus size={16} /> Record payment</Button> : undefined} />{isCustomer ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{payments.map((p, i) => <tr key={p.id || i}><td>{String(p.paid_at || '').slice(0, 10)}</td><td>{p.payment_method}</td><td>{p.reference_note || '—'}</td><td><b>{money(p.amount)}</b></td></tr>)}</tbody></table>{!payments.length && <Empty label="No payments recorded yet" />}</div> : <><Toolbar search={search} setSearch={setSearch} placeholder="Search customers for payment collection" /><CustomerTable rows={filtered} onQr={openQr} onDeliver={c => {
            setPaymentForm({
              ...paymentForm,
              customer_id: String(c.id),
              amount: ''
            });
            setSelectedCustomer(c);
            setModal('payment');
          }} actionLabel="Collect" hideCode hideQr showDue /></>}</section>}
 {page === 'Collect Payment' && isDelivery && <section className="panel"><PanelHead title="Collect a payment" subtitle="You can collect only from customers assigned to you; due counts include completed unpaid billing months" /><CustomerTable rows={filtered} onQr={openQr} onDeliver={c => {
          setPaymentForm({
            ...paymentForm,
            customer_id: String(c.id),
            amount: ''
          });
          setSelectedCustomer(c);
          setModal('payment');
        }} actionLabel="Collect payment" hideCode hideQr showDue /></section>}
 {page === 'Monthly Billing' && isOwner && <section className="panel"><PanelHead title="Monthly billing" subtitle="Monthly milk supply, collections and customer payment status" action={<label className="month-select">Billing month <input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>} /><div className="metrics-grid metrics-grid--compact"><Metric title="Milk supplied" value={`${Number(reportSummary.milk_litres || 0).toFixed(1)} L`} note="Total delivered this month" icon={<Droplets />} /><Metric title="Amount to collect" value={money(reportSummary.billed)} note="Based on completed deliveries" icon={<ReceiptText />} /><Metric title="Amount received" value={money(reportSummary.received)} note="Recorded payments this month" icon={<Wallet />} tone="mint" /><Metric title="Paid customers" value={String(reportSummary.paid_customers || 0)} note="Fully paid for this month" icon={<Check />} tone="blue" /><Metric title="Unpaid customers" value={String(reportSummary.unpaid_customers || 0)} note="Have a remaining monthly balance" icon={<CircleDollarSign />} tone="amber" /><Metric title="Due customers" value={String(reportSummary.due_customers || 0)} note="Previous completed months still unpaid" icon={<Clock3 />} /></div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Delivery charges</th><th>Payments</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>{bills.map(b => <tr key={b.customer_id}><td><b>{b.name}</b></td><td>{b.phone || '—'}</td><td>{money(b.billed)}</td><td>{money(b.paid)}</td><td><b>{money(b.balance)}</b></td><td><span className={`status ${Number(b.billed) > 0 && Number(b.balance) <= 0 ? 'status-ok' : Number(b.balance) > 0 ? 'status-pending' : ''}`}>{Number(b.billed) <= 0 ? 'No delivery' : Number(b.balance) <= 0 ? 'Paid' : 'Unpaid'}</span></td></tr>)}</tbody></table>{!bills.length && <Empty label="No billing records for this month" />}</div></section>}
 {page === 'Bills & Payments' && isCustomer && <section className="panel">
   <PanelHead title="Bills & payments" subtitle="Your current calendar-month statement and payment history" />
   <div className="tab-row" role="tablist" aria-label="Bills and payment history">
     <button className={loginTab === 'bill' ? 'active' : ''} onClick={() => setLoginTab('bill')}>My bill</button>
     <button className={loginTab === 'payments' ? 'active' : ''} onClick={() => setLoginTab('payments')}>My payments</button>
   </div>
   {loginTab === 'bill' ? <section className="customer-bill">
     <div className="bill-cycle"><CalendarDays size={18} /> Billing cycle: 30 days · {month}</div>
     <div className="bill-details">
       <div><span>Description</span><b>Values</b></div>
       <div><span>Daily consumption</span><b>{Number(billing?.summary?.daily_consumption ?? overview.summary?.daily_consumption ?? 0).toFixed(1)} litres</b></div>
       <div><span>Billing cycle</span><b>30 Days</b></div>
       <div><span>Total volume</span><b>{Number(billing?.summary?.litres ?? overview.summary?.litres ?? 0).toFixed(1)} litres</b></div>
       <div><span>Price per litre</span><b>{money(billing?.summary?.average_rate ?? 0)}</b></div>
       <div className="bill-total"><span>Total monthly bill</span><b>{money(billing?.summary?.total ?? overview.summary?.total)}</b></div>
       <div><span>Advance payment deducted</span><b>{money(billing?.summary?.advance_credit ?? 0)}</b></div>
       <div><span>Amount remaining</span><b>{money(billing?.summary?.balance ?? overview.summary?.balance)}</b></div>
       <div><span>Previous unpaid due</span><b>{money(billing?.summary?.due_balance ?? 0)}</b></div>
     </div>
     <DeliveryTable rows={deliveries.filter(delivery => String(delivery.delivered_at || '').slice(0, 7) === month)} />
   </section> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{payments.map((payment, index) => <tr key={payment.id || index}><td>{String(payment.paid_at || '').slice(0, 10)}</td><td>{payment.payment_method}</td><td>{payment.reference_note || '—'}</td><td><b>{money(payment.amount)}</b></td></tr>)}</tbody></table>{!payments.length && <Empty label="No payments recorded yet" />}</div>}
 </section>}
 {page === 'Delivery History' && isCustomer && <section className="panel"><PanelHead title="Delivery history" subtitle="Tap a date to inspect its delivery details" /><DeliveryCalendar deliveries={deliveries} selectedDate={selectedHistoryDate} onSelect={setSelectedHistoryDate} month={selectedMonthDate} onMonthChange={setSelectedMonthDate} />{selectedHistoryDate && <HistoryDetails deliveries={deliveries.filter(delivery => String(delivery.delivered_at || '').slice(0, 10) === selectedHistoryDate)} date={selectedHistoryDate} />}</section>}
 {page === 'My QR Code' && isCustomer && <section className="panel qr-page"><Icon3D><QrCode size={34} /></Icon3D><h2>Your customer QR code</h2><p>Show this QR to your delivery partner so they can identify your account.</p>{qrData ? <img src={qrData} alt="Your customer QR code" /> : <Empty label="QR code unavailable" />}<b>{user.name}</b><small>Keep this code private to your household.</small><Button variant="secondary" onClick={closeCustomerQr}>Close and open dashboard</Button></section>}
 {page === 'Reports' && isOwner && <section className="panel"><PanelHead title="Reports & analytics" subtitle={`Monthly business report • ${month}`} /><div className="metrics-grid metrics-grid--compact"><Metric title="Total milk supply" value={`${Number(reportSummary.milk_litres || 0).toFixed(1)} L`} note="Completed deliveries" icon={<Droplets />} /><Metric title="Total earnings" value={money(reportSummary.received)} note="Payments received during the month" icon={<TrendingUp />} tone="mint" /><Metric title="Amount to collect" value={money(reportSummary.billed)} note="Delivery charges for the selected month" icon={<ReceiptText />} /><Metric title="Paid customers" value={String(reportSummary.paid_customers || 0)} note="Fully paid" icon={<Check />} tone="blue" /><Metric title="Unpaid customers" value={String(reportSummary.unpaid_customers || 0)} note="Monthly balance remains" icon={<CircleDollarSign />} tone="amber" /></div><Button variant="secondary" onClick={() => {
          const rows = [['Customer', 'Phone', 'Billed', 'Paid', 'Balance'], ...bills.map(b => [b.name, b.phone, b.billed, b.paid, b.balance])];
          const csv = rows.map(r => r.map(x => `"${String(x ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], {
            type: 'text/csv'
          }));
          a.download = `milkmate-report-${month}.csv`;
          a.click();
          URL.revokeObjectURL(a.href);
        }}><ArrowDownLeft size={16} /> Export CSV</Button></section>}
 {page === 'Notifications' && <NotificationCenter notifications={notifications} tickets={supportTickets} user={user} isOwner={isOwner} isCustomer={isCustomer} isDelivery={isDelivery} hasAssignedDeliveryBoy={Boolean(overview.customer?.assigned_to)} customers={customers} boys={activeBoys} recipientType={notificationRecipientType} setRecipientType={setNotificationRecipientType} recipientId={notificationRecipientId} setRecipientId={setNotificationRecipientId} ticketRecipientType={ticketRecipientType} setTicketRecipientType={setTicketRecipientType} messageText={messageText} setMessageText={setMessageText} onSend={sendNotification} onDelete={deleteNotification} onReplyToTicket={replyToTicket} onTicketStatusChange={setTicketStatus} />}
 {page === 'Profile' && <section className="panel profile-panel"><div className="avatar avatar-large">{initials(user.name)}</div><h2>{user.name}</h2><p>{user.email}</p><span className="status status-ok">{roleLabel(user.role)}</span><div className="profile-actions"><Button variant="secondary" onClick={refresh}><RefreshCw size={16} /> Refresh account</Button><Button variant="danger" onClick={signOut}><LogOut size={16} /> Sign out</Button></div></section>}
 </main>
 {selectedBoy && <div className="modal-backdrop" onClick={() => setSelectedBoy(null)}><section className="modal assigned-customer-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelectedBoy(null)} aria-label="Close assigned customers"><X size={19} /></button><span className="eyebrow">DELIVERY ROUTE</span><h2>{selectedBoy.name}</h2><p className="modal-sub">Customers assigned to this delivery partner.</p><div className="assigned-customer-list">{customers.filter(customer => Number(customer.assigned_to) === selectedBoy.id).map(customer => <article className="assigned-customer" key={customer.id}><div className="assigned-customer-main"><span className="avatar">{initials(customer.name)}</span><div><b>{customer.name}</b><small>{customer.phone || 'No phone number'}</small><small>{customer.address || 'No address provided'}</small></div></div><div className="assigned-customer-meta"><span className="assigned-customer-tag">{customer.milk_type || 'cow'} milk</span><span className="assigned-customer-tag">{Number(customer.quantity_litres || 0)} L / delivery</span><span className="assigned-customer-tag">{[customer.morning_enabled && 'Morning', customer.evening_enabled && 'Evening'].filter(Boolean).join(' & ') || 'No routine'}</span></div></article>)}{!customers.some(customer => Number(customer.assigned_to) === selectedBoy.id) && <Empty label="No customers assigned" />}</div><div className="modal-actions"><Button variant="secondary" onClick={() => setSelectedBoy(null)}>Close</Button></div></section></div>}
 {modal && <div className="modal-backdrop" onClick={() => setModal('')}><section className="modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setModal('')}><X size={19} /></button>
 {modal === 'customer' && <form onSubmit={saveCustomer}><span className="eyebrow">CUSTOMER MANAGEMENT</span><h2>{isDelivery ? 'Add customer to my route' : 'Create customer'}</h2><p className="modal-sub">A unique customer QR code is generated automatically.</p><div className="form-grid"><Field label="Full name"><input required value={customerForm.name} onChange={e => setCustomerForm({
                ...customerForm,
                name: e.target.value
              })} /></Field><Field label="Mobile number"><input type="tel" inputMode="tel" required value={customerForm.phone} onChange={e => setCustomerForm({
                ...customerForm,
                phone: e.target.value
              })} /></Field><Field label="Milk type"><select value={customerForm.milk_type} onChange={e => setCustomerForm({ ...customerForm, milk_type: e.target.value })}><option value="cow">Cow milk</option><option value="buffalo">Buffalo milk</option></select></Field><Field label="Quantity per delivery (litres)"><input type="number" min="0.1" max="100" step="0.1" required value={customerForm.quantity_litres} onChange={e => setCustomerForm({ ...customerForm, quantity_litres: e.target.value })} /></Field><fieldset className="routine-fields"><legend>Delivery routines</legend><label><input type="checkbox" checked={customerForm.morning_enabled} onChange={e => setCustomerForm({ ...customerForm, morning_enabled: e.target.checked })} /> Morning</label><label><input type="checkbox" checked={customerForm.evening_enabled} onChange={e => setCustomerForm({ ...customerForm, evening_enabled: e.target.checked })} /> Evening</label></fieldset><Field label="Full address"><textarea required value={customerForm.address} onChange={e => setCustomerForm({
                ...customerForm,
                address: e.target.value
              })} /></Field>{!isDelivery && <Field label="Assign delivery boy"><select value={customerForm.assigned_to} onChange={e => setCustomerForm({
                ...customerForm,
                assigned_to: e.target.value
              })}><option value="">Unassigned</option>{activeBoys.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}<Field label="Customer login email (optional)"><input type="email" value={customerForm.email} onChange={e => setCustomerForm({
                ...customerForm,
                email: e.target.value
              })} /></Field><Field label="Initial password (min 8 characters)"><input type="password" minLength={8} required value={customerForm.password} onChange={e => setCustomerForm({
                ...customerForm,
                password: e.target.value
              })} /><small className="field-hint">The customer's mobile number is the sign-in username. Passwords are set by an administrator.</small></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setModal('')}>Cancel</Button><Button type="submit">Create customer <ArrowRight size={16} /></Button></div></form>}
 {modal === 'boy' && <form onSubmit={saveBoy}><span className="eyebrow">TEAM MANAGEMENT</span><h2>Add delivery boy</h2><p className="modal-sub">The delivery partner can sign in using these credentials.</p><div className="form-grid"><Field label="Full name"><input required value={boyForm.name} onChange={e => setBoyForm({
                ...boyForm,
                name: e.target.value
              })} /></Field><Field label="Email address"><input type="email" required value={boyForm.email} onChange={e => setBoyForm({
                ...boyForm,
                email: e.target.value
              })} /></Field><Field label="Phone number"><input type="tel" inputMode="tel" required value={boyForm.phone} onChange={e => setBoyForm({ ...boyForm, phone: e.target.value })} /></Field><Field label="Temporary password (min 8 characters)"><input type="password" minLength={8} required value={boyForm.password} onChange={e => setBoyForm({
                ...boyForm,
                password: e.target.value
              })} /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setModal('')}>Cancel</Button><Button type="submit">Create login <ArrowRight size={16} /></Button></div></form>}
 {modal === 'customer-login' && customerToSetupLogin && <form onSubmit={saveCustomerLogin}><span className="eyebrow">CUSTOMER ACCOUNT</span><h2>{customerToSetupLogin.login_enabled ? 'Change customer password' : 'Set up customer login'}</h2><p className="modal-sub">Sign-in username: <b>{customerToSetupLogin.phone}</b>. Set a password and share it securely with {customerToSetupLogin.name}. Passwords are not shown again after saving.</p><Field label={customerToSetupLogin.login_enabled ? 'New password (at least 8 characters)' : 'Customer password (at least 8 characters)'}><input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={customerLoginPassword} onChange={e => setCustomerLoginPassword(e.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" onClick={() => { setModal(''); setCustomerToSetupLogin(null); setCustomerLoginPassword(''); }}>Cancel</Button><Button type="submit">{customerToSetupLogin.login_enabled ? 'Change password' : 'Save customer login'} <Check size={16} /></Button></div></form>}
 {modal === 'boy-login' && driverToSetupLogin && <form onSubmit={saveBoyLogin}><span className="eyebrow">TEAM MANAGEMENT</span><h2>{driverToSetupLogin.login_enabled ? 'Change delivery-boy password' : 'Set up sign-in'}</h2><p className="modal-sub">{driverToSetupLogin.login_enabled ? `Set a new password for ${driverToSetupLogin.name}. They can sign in with their phone number or email.` : `Create login credentials for ${driverToSetupLogin.name}. Their phone number is already on the delivery profile.`}</p><Field label="Email address"><input type="email" required autoComplete="email" readOnly={Boolean(driverToSetupLogin.login_enabled)} value={boyLoginForm.email} onChange={e => setBoyLoginForm({ ...boyLoginForm, email: e.target.value })} /></Field><Field label={driverToSetupLogin.login_enabled ? 'New password (at least 8 characters)' : 'Temporary password (at least 8 characters)'}><input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={boyLoginForm.password} onChange={e => setBoyLoginForm({ ...boyLoginForm, password: e.target.value })} /></Field><div className="modal-actions"><Button variant="secondary" onClick={() => { setModal(''); setDriverToSetupLogin(null); setBoyLoginForm({ email: '', password: '' }); }}>Cancel</Button><Button type="submit">{driverToSetupLogin.login_enabled ? 'Change password' : 'Save login'} <Check size={16} /></Button></div></form>}
 {modal === 'rate' && <form onSubmit={saveRate}><span className="eyebrow">PRICING</span><h2>Update milk rate</h2><div className="form-grid"><Field label="Milk type"><select value={rateForm.milk_type} onChange={e => setRateForm({
                ...rateForm,
                milk_type: e.target.value
              })}><option value="cow">Cow milk</option><option value="buffalo">Buffalo milk</option></select></Field><Field label="Rate per litre (₹)"><input type="number" min="0.01" step="0.01" required value={rateForm.rate_per_litre} onChange={e => setRateForm({
                ...rateForm,
                rate_per_litre: e.target.value
              })} /></Field><Field label="Effective from"><input type="date" required value={rateForm.effective_from} onChange={e => setRateForm({
                ...rateForm,
                effective_from: e.target.value
              })} /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setModal('')}>Cancel</Button><Button type="submit">Save rate</Button></div></form>}
 {modal === 'delivery' && <form onSubmit={previewDelivery}><span className="eyebrow">DELIVERY WORKFLOW • STEP 1 OF 2</span><h2>Review delivery details</h2><p className="modal-sub">Milk type, usual quantity and available schedule are prefilled from the customer profile. Adjust the actual quantity for this delivery if needed.</p><Field label="Customer"><select required value={deliveryForm.customer_id} onChange={e => selectDeliveryCustomer(e.target.value)}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.customer_code}</option>)}</select></Field><div className="form-grid"><Field label="Milk type"><select value={deliveryForm.milk_type} onChange={e => setDeliveryForm({
                ...deliveryForm,
                milk_type: e.target.value
              })}><option value="cow">Cow milk</option><option value="buffalo">Buffalo milk</option></select></Field><Field label="Delivery routine"><select value={deliveryForm.routine} onChange={e => setDeliveryForm({ ...deliveryForm, routine: e.target.value })}><option value="morning">Morning</option><option value="evening">Evening</option><option value="other">Other</option></select></Field><Field label="Actual quantity (litres)"><input type="number" min="0.1" step="0.1" required value={deliveryForm.quantity_litres} onChange={e => setDeliveryForm({
                ...deliveryForm,
                quantity_litres: e.target.value
              })} /></Field><Field label="Notes (optional)"><textarea value={deliveryForm.notes} onChange={e => setDeliveryForm({
                ...deliveryForm,
                notes: e.target.value
              })} /></Field></div><div className="amount-preview"><div><small>Calculated price</small><strong>{money(Number(deliveryForm.quantity_litres) * Number(rates.find(r => r.milk_type === deliveryForm.milk_type)?.rate_per_litre || 0))}</strong></div><span>{money(rates.find(r => r.milk_type === deliveryForm.milk_type)?.rate_per_litre || 0)} / litre</span></div><div className="modal-actions"><Button variant="secondary" onClick={() => setModal('')}>Cancel</Button><Button type="submit">Review & confirm <ArrowRight size={16} /></Button></div></form>}
 {modal === 'confirm-delivery' && <div><span className="eyebrow">DELIVERY WORKFLOW • FINAL CONFIRMATION</span><h2>Confirm this delivery?</h2><p className="modal-sub">This will permanently record the delivery and update the customer's balance.</p><div className="confirm-summary"><div><span>Customer</span><b>{deliveryPreview?.customer?.name || customers.find(c => String(c.id) === deliveryPreview?.customer_id)?.name || 'Selected customer'}</b></div><div><span>Milk type</span><b>{deliveryPreview?.milk_type} milk</b></div><div><span>Actual quantity</span><b>{deliveryPreview?.quantity_litres} L</b></div><div><span>Rate</span><b>{money(deliveryPreview?.rate)}/L</b></div><div className="confirm-total"><span>Total charge</span><b>{money(deliveryPreview?.amount)}</b></div></div><div className="modal-actions"><Button variant="secondary" onClick={() => setModal('delivery')}>Back to edit</Button><Button onClick={confirmDelivery}>Confirm & save <Check size={16} /></Button></div></div>}
 {modal === 'payment' && <form onSubmit={savePayment}><span className="eyebrow">PAYMENT COLLECTION</span><h2>Record payment</h2><p className="modal-sub">Payments are stored separately from delivery charges.</p><Field label="Customer"><select required value={paymentForm.customer_id} onChange={e => setPaymentForm({
              ...paymentForm,
              customer_id: e.target.value
            })}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="form-grid"><Field label="Amount received (₹)"><input type="number" min="0.01" step="0.01" required value={paymentForm.amount} onChange={e => setPaymentForm({
                ...paymentForm,
                amount: e.target.value
              })} /></Field><Field label="Payment method"><select value={paymentForm.payment_method} onChange={e => setPaymentForm({
                ...paymentForm,
                payment_method: e.target.value
              })}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></Field><Field label="Reference / note (optional)"><input value={paymentForm.reference_note} onChange={e => setPaymentForm({
                ...paymentForm,
                reference_note: e.target.value
              })} /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setModal('')}>Cancel</Button><Button type="submit">Save payment <Check size={16} /></Button></div></form>}
 {modal === 'temporary' && <form onSubmit={saveTemporaryDelivery}><span className="eyebrow">ONE-TIME DELIVERY</span><h2>Record an “Others” delivery</h2><p className="modal-sub">This records a temporary delivery and charge without adding a customer login.</p><Field label="Customer phone number"><input type="tel" inputMode="tel" required value={temporaryDelivery.phone} onChange={event => setTemporaryDelivery({ ...temporaryDelivery, phone: event.target.value })} /></Field><div className="form-grid"><Field label="Milk type"><select value={temporaryDelivery.milk_type} onChange={event => setTemporaryDelivery({ ...temporaryDelivery, milk_type: event.target.value })}><option value="cow">Cow milk</option><option value="buffalo">Buffalo milk</option></select></Field><Field label="Quantity (litres)"><input type="number" min="0.1" max="100" step="0.1" required value={temporaryDelivery.quantity_litres} onChange={event => setTemporaryDelivery({ ...temporaryDelivery, quantity_litres: event.target.value })} /></Field><Field label="Routine"><select value={temporaryDelivery.routine} onChange={event => setTemporaryDelivery({ ...temporaryDelivery, routine: event.target.value })}><option value="morning">Morning</option><option value="evening">Evening</option><option value="other">Other</option></select></Field></div><div className="amount-preview"><small>Price is calculated using the current milk rate.</small><b>{money(Number(temporaryDelivery.quantity_litres) * Number(rates.find(rate => rate.milk_type === temporaryDelivery.milk_type)?.rate_per_litre || 0))}</b></div><div className="modal-actions"><Button variant="secondary" onClick={() => setModal('')}>Cancel</Button><Button type="submit">Record delivery <Check size={16} /></Button></div></form>}
 {modal === 'scan' && <div><span className="eyebrow">QR CUSTOMER LOOKUP</span><h2>Identify customer</h2><p className="modal-sub">Scan a customer QR code or enter the customer code / decoded QR content.</p><Field label="Customer code or QR payload"><input autoFocus value={scanCode} onChange={e => setScanCode(e.target.value)} placeholder="Paste code or scan result" /></Field><div className="modal-actions scan-actions"><Button variant="secondary" onClick={() => { setModal(''); setShowScanner(false); window.setTimeout(() => setShowScanner(true), 0); }}><ScanLine size={16} /> Open camera scanner</Button><Button onClick={() => beginScan(scanCode)} disabled={!scanCode.trim()}>Find customer <ArrowRight size={16} /></Button></div></div>}
 {modal === 'supplier-password' && supplierToChangePassword && <form onSubmit={saveSupplierPassword}><span className="eyebrow">SUPPLIER ACCOUNT</span><h2>{supplierToChangePassword.login_enabled ? 'Change supplier password' : 'Set up supplier login'}</h2><p className="modal-sub">Username: <b>{supplierToChangePassword.username}</b>. Share the new password securely; it will not be displayed again.</p><Field label="New password (at least 8 characters)"><input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={supplierPassword} onChange={event => setSupplierPassword(event.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" onClick={() => { setModal(''); setSupplierToChangePassword(null); setSupplierPassword(''); }}>Cancel</Button><Button type="submit">Save supplier password <Check size={16} /></Button></div></form>}
 {modal === 'qr' && <div className="qr-modal"><span className="eyebrow">MILKMATE CUSTOMER QR</span><h2>{selectedCustomer?.name || user?.name}</h2><p className="modal-sub">Scan this code to identify the customer.</p>{qrData && <img src={qrData} alt="Customer QR" />}<b>{selectedCustomer?.customer_code}</b><Button variant="secondary" onClick={() => setModal('')}>Done</Button></div>}
 </section></div>}{showScanner && <Scanner onResult={beginScan} onClose={() => { setShowScanner(false); setModal(''); }} onError={setError} onOthers={() => { setShowScanner(false); setModal('temporary'); }} onAssigned={() => { setShowScanner(false); menuClick('My Customers'); }} />}
 </div>;
}
function LoginPanel({
 phone,
 setPhone,
 password,
 setPassword,
 loading,
 error,
 success,
 resetMode,
 setResetMode,
 resetCodeSent,
 code,
 setCode,
 newPassword,
 setNewPassword,
 onSignIn,
 onRequestReset,
 onConfirmReset
}: {
 phone: string;
 setPhone: (value: string) => void;
 password: string;
 setPassword: (value: string) => void;
 loading: boolean;
 error: string;
 success: string;
 resetMode: boolean;
 setResetMode: (value: boolean) => void;
 resetCodeSent: boolean;
 code: string;
 setCode: (value: string) => void;
 newPassword: string;
 setNewPassword: (value: string) => void;
 onSignIn: (event: FormEvent) => void;
 onRequestReset: () => void;
 onConfirmReset: (event: FormEvent) => void;
}) {
 return <main className="login-layout">
   <section className="login-hero">
     <Brand />
     <div className="hero-copy">
       <span className="eyebrow"><Sparkles size={15} /> FRESHNESS, DELIVERED</span>
       <h1>Your daily milk,<br /><em>beautifully managed.</em></h1>
       <p>One connected workspace for dairy owners, delivery partners and customers.</p>
       <div className="hero-stats">
         <div><Icon3D><Milk /></Icon3D><b>Daily deliveries</b><small>Simple, reliable tracking</small></div>
         <div><Icon3D tone="amber"><QrCode /></Icon3D><b>QR powered</b><small>Quick customer lookup</small></div>
       </div>
     </div>
     <div className="hero-orb orb-one" />
     <div className="hero-orb orb-two" />
   </section>
   <section className="login-panel">
     <form onSubmit={resetMode ? onConfirmReset : onSignIn} className="login-card">
       <span className="eyebrow">{resetMode ? 'ACCOUNT RECOVERY' : 'WELCOME BACK'}</span>
       <h2>{resetMode ? 'Reset your password' : 'Sign in to Kakarla Dairy Farm'}</h2>
       <p>{resetMode ? 'We will send a one-time code to the phone number on your account.' : 'Sign in with your email, phone number, or supplier username.'}</p>
       {error && <div className="alert alert-error">{error}</div>}
       {success && <div className="alert alert-success">{success}</div>}
       <Field label={resetMode ? 'Phone number' : 'Email or phone number'}>
         <input type="text" inputMode={resetMode ? 'tel' : undefined} autoComplete="username" required value={phone} onChange={event => setPhone(event.target.value)} placeholder={resetMode ? '+91 98765 43210' : 'name@example.com or +91 98765 43210'} />
       </Field>
       {!resetMode && <>
         <Field label="Password">
           <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" />
         </Field>
         <button className="text-button forgot-password" type="button" onClick={() => setResetMode(true)}>Forgot password?</button>
         <Button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in securely'} <ArrowRight size={17} /></Button>
         <small className="login-hint"><ShieldCheck size={15} /> Staff can also use their existing email until a phone number is added.</small>
       </>}
       {resetMode && !resetCodeSent && <>
         <Button type="button" disabled={loading} onClick={onRequestReset}>{loading ? 'Sending code…' : 'Send reset code'} <ArrowRight size={17} /></Button>
       </>}
       {resetMode && resetCodeSent && <>
         <Field label="Six-digit code"><input inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
         <Field label="New password (at least 8 characters)"><input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} /></Field>
         <Button type="submit" disabled={loading}>{loading ? 'Updating…' : 'Update password'} <Check size={17} /></Button>
       </>}
       {resetMode && <button className="text-button forgot-password" type="button" onClick={() => setResetMode(false)}>Back to sign in</button>}
     </form>
   </section>
 </main>;
}
function DeliveryCalendar({
 deliveries,
 selectedDate,
 onSelect,
 month,
 onMonthChange
}: {
 deliveries: Delivery[];
 selectedDate: string;
 onSelect: (date: string) => void;
 month: Date;
 onMonthChange: (date: Date) => void;
}) {
 const year = month.getFullYear();
 const monthIndex = month.getMonth();
 const firstWeekday = new Date(year, monthIndex, 1).getDay();
 const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
 const today = new Date();
 const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
 const counts = new Map<string, Set<string>>();
 deliveries.forEach(delivery => {
   const day = String(delivery.delivered_at || '').slice(0, 10);
   if (!counts.has(day)) counts.set(day, new Set());
   counts.get(day)?.add(delivery.routine || 'other');
 });
 const shiftMonth = (amount: number) => onMonthChange(new Date(year, monthIndex + amount, 1));
 return <section className="delivery-calendar" aria-label="Delivery calendar">
   <div className="calendar-heading">
     <button className="btn btn-secondary" onClick={() => shiftMonth(-1)}>Previous</button>
     <h3>{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(month)}</h3>
     <button className="btn btn-secondary" disabled={year === today.getFullYear() && monthIndex >= today.getMonth()} onClick={() => shiftMonth(1)}>Next</button>
   </div>
   <div className="calendar-grid calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div>
   <div className="calendar-grid">
     {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} className="calendar-blank" />)}
     {Array.from({ length: daysInMonth }, (_, index) => {
       const day = index + 1;
       const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
       const count = counts.get(date)?.size || 0;
       const missed = date < todayKey && count === 0;
       const stateClass = count > 1 ? 'calendar-day--full' : count === 1 ? 'calendar-day--partial' : missed ? 'calendar-day--missed' : '';
       return <button key={date} className={`calendar-day ${stateClass} ${selectedDate === date ? 'calendar-day--selected' : ''}`} onClick={() => onSelect(date)} aria-label={`${date}${count ? `, ${count} routines delivered` : missed ? ', no delivery recorded' : ''}`}>
         <span>{day}</span>{count > 0 && <small>{count} {count === 1 ? 'round' : 'rounds'}</small>}
       </button>;
     })}
   </div>
   <div className="calendar-legend"><span><i className="legend-full" /> Two routines</span><span><i className="legend-partial" /> One routine</span><span><i className="legend-missed" /> No delivery</span></div>
 </section>;
}
function HistoryDetails({ deliveries, date }: { deliveries: Delivery[]; date: string }) {
 const displayDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'full' }).format(new Date(`${date}T12:00:00`));
 return <section className="history-details">
   <h3>{displayDate}</h3>
   {!deliveries.length ? <p>No delivery was recorded on this date.</p> : <div className="table-wrap"><table><thead><tr><th>Routine</th><th>Milk type</th><th>Quantity</th><th>Amount</th><th>Notes</th></tr></thead><tbody>{deliveries.map(delivery => <tr key={delivery.id}><td>{delivery.routine || 'Recorded'}</td><td>{delivery.milk_type} milk</td><td>{Number(delivery.quantity_litres).toFixed(1)} litres</td><td>{money(delivery.amount)}</td><td>{delivery.notes || '—'}</td></tr>)}</tbody></table></div>}
 </section>;
}
function NotificationCenter({
 notifications,
 tickets,
 user,
 isOwner,
 isCustomer,
 isDelivery,
 hasAssignedDeliveryBoy,
 customers,
 boys,
 recipientType,
 setRecipientType,
 recipientId,
 setRecipientId,
 ticketRecipientType,
 setTicketRecipientType,
 messageText,
 setMessageText,
 onSend,
 onDelete,
 onReplyToTicket,
 onTicketStatusChange
}: {
 notifications: any[];
 tickets: SupportTicket[];
 user: User;
 isOwner: boolean;
 isCustomer: boolean;
 isDelivery: boolean;
 hasAssignedDeliveryBoy: boolean;
 customers: Customer[];
 boys: DeliveryBoy[];
 recipientType: 'all_customers' | 'customer' | 'delivery_boy';
 setRecipientType: (type: 'all_customers' | 'customer' | 'delivery_boy') => void;
 recipientId: string;
 setRecipientId: (id: string) => void;
 ticketRecipientType: 'owner' | 'delivery_boy';
 setTicketRecipientType: (type: 'owner' | 'delivery_boy') => void;
 messageText: string;
 setMessageText: (value: string) => void;
 onSend: (event: FormEvent) => void;
 onDelete: (notification: any) => void;
 onReplyToTicket: (ticketId: number, message: string) => Promise<boolean>;
 onTicketStatusChange: (ticketId: number, status: 'open' | 'closed') => void;
}) {
 const [recipientSearch, setRecipientSearch] = useState('');
 const [activitySearch, setActivitySearch] = useState('');
 const [directionFilter, setDirectionFilter] = useState<'all' | 'inbound' | 'outbound'>('all');
 const [channelFilter, setChannelFilter] = useState<'all' | 'in_app' | 'telegram'>('all');
 const [ticketReplies, setTicketReplies] = useState<Record<number, string>>({});
 const eligibleRecipients = (recipientType === 'customer' ? customers : boys).filter(recipient =>
  `${recipient.name} ${'phone' in recipient ? recipient.phone : ''} ${'email' in recipient ? recipient.email : ''}`
   .toLowerCase().includes(recipientSearch.toLowerCase())
 );
 const filteredNotifications = notifications.filter(notification => {
  const matchesDirection = directionFilter === 'all' || notification.direction === directionFilter;
  const matchesChannel = channelFilter === 'all' || notification.channel === channelFilter;
  const searchable = `${notification.customer_name || user.name} ${notification.message || ''} ${notification.error_text || ''}`.toLowerCase();
  return matchesDirection && matchesChannel && searchable.includes(activitySearch.toLowerCase());
 });
 const filteredTickets = tickets.filter(ticket =>
  `${ticket.customer_name} ${ticket.customer_phone} ${ticket.recipient_name} ${ticket.messages.map(message => message.message).join(' ')}`
   .toLowerCase().includes(activitySearch.toLowerCase())
 );
 const submitTicketReply = async (event: FormEvent, ticketId: number) => {
  event.preventDefault();
  const message = (ticketReplies[ticketId] || '').trim();
  if (!message) return;
  if (await onReplyToTicket(ticketId, message)) {
   setTicketReplies(current => ({ ...current, [ticketId]: '' }));
  }
 };
 return <section className="panel">
  <PanelHead title="Notification center" subtitle={isOwner ? 'Search recipients, review sent and received messages, and handle support tickets' : 'Delivery bills, dairy messages, and support ticket replies'} />
  {(isOwner || isCustomer) && <form className="notification-compose" onSubmit={onSend}>
    {isOwner && <div className="notification-recipient-fields">
      <Field label="Recipient group"><select value={recipientType} onChange={event => {
        setRecipientType(event.target.value as 'all_customers' | 'customer' | 'delivery_boy');
        setRecipientId('');
        setRecipientSearch('');
      }}><option value="all_customers">All active customers</option><option value="customer">A customer</option><option value="delivery_boy">A delivery partner</option></select></Field>
      {recipientType !== 'all_customers' && <Field label={recipientType === 'customer' ? 'Find customer' : 'Find delivery partner'}><input type="search" value={recipientSearch} onChange={event => setRecipientSearch(event.target.value)} placeholder="Search by name, phone, or email" /><select required value={recipientId} onChange={event => setRecipientId(event.target.value)}><option value="">Choose a recipient ({eligibleRecipients.length})</option>{eligibleRecipients.map(recipient => <option key={recipient.id} value={recipient.id}>{recipient.name}{'phone' in recipient && recipient.phone ? ` · ${recipient.phone}` : ''}{'email' in recipient && recipient.email ? ` · ${recipient.email}` : ''}</option>)}</select></Field>}
    </div>}
    {isCustomer && <Field label="Send ticket to"><select value={ticketRecipientType} onChange={event => setTicketRecipientType(event.target.value as 'owner' | 'delivery_boy')}><option value="owner">Dairy owner</option>{hasAssignedDeliveryBoy && <option value="delivery_boy">My assigned delivery partner</option>}</select></Field>}
    <Field label={isCustomer ? 'Support request' : recipientType === 'delivery_boy' ? 'Message to the delivery partner' : recipientType === 'customer' ? 'Message to the customer' : 'Message to all active customers'}><textarea required maxLength={2000} value={messageText} onChange={event => setMessageText(event.target.value)} placeholder={isCustomer ? 'Describe your question or request...' : 'Write a clear message...'} /></Field>
    <Button type="submit"><Send size={16} />{isCustomer ? 'Open support ticket' : recipientType === 'delivery_boy' ? 'Send to delivery partner' : recipientType === 'customer' ? 'Send to customer' : 'Send to all customers'}</Button>
  </form>}
  <div className="notification-filters">
   <Field label="Search messages or recipients"><input type="search" value={activitySearch} onChange={event => setActivitySearch(event.target.value)} placeholder="Search by customer, delivery partner, or message" /></Field>
   <Field label="Direction"><select value={directionFilter} onChange={event => setDirectionFilter(event.target.value as typeof directionFilter)}><option value="all">Sent and received</option><option value="outbound">Sent</option><option value="inbound">Received</option></select></Field>
   <Field label="Channel"><select value={channelFilter} onChange={event => setChannelFilter(event.target.value as typeof channelFilter)}><option value="all">All channels</option><option value="in_app">In-app</option><option value="telegram">Telegram</option></select></Field>
  </div>
  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Direction</th><th>Channel</th><th>{isOwner || isDelivery ? 'Recipient' : 'From'}</th><th>Message / bill</th><th>Action</th></tr></thead><tbody>{filteredNotifications.map((notification, index) => <tr key={notification.id || index}>
    <td>{notification.created_at ? new Date(notification.created_at).toLocaleString() : '—'}</td>
    <td><span className={`status ${notification.direction === 'inbound' ? 'status-ok' : ''}`}>{notification.direction === 'inbound' ? 'Received' : 'Sent'}</span></td>
    <td>{notification.channel === 'in_app' ? notification.delivery_id ? 'In-app bill' : 'In-app' : notification.channel || '—'}</td>
    <td>{notification.direction === 'inbound' ? notification.customer_name || 'Customer' : isCustomer || isDelivery ? 'Kakarla Dairy Farm' : notification.customer_name || '—'}</td>
     <td className="notification-message">{notification.message || notification.error_text || '—'}</td>
     <td><button className="table-action danger-action" onClick={() => onDelete(notification)} aria-label="Delete notification"><Trash2 size={15} /> Delete</button></td>
   </tr>)}</tbody></table>{!filteredNotifications.length && <div className="notice-empty"><Bell size={27} /><b>No matching notifications</b><span>Try changing the search or filters.</span></div>}</div>
  <div className="support-ticket-section"><PanelHead title="Support tickets" subtitle={isOwner ? 'Customer requests routed to you or the assigned delivery partner' : 'Follow the conversation and reply to open requests'} />
   {!filteredTickets.length ? <div className="notice-empty"><Send size={25} /><b>No matching support tickets</b><span>New customer requests will appear here.</span></div> : <div className="support-ticket-list">{filteredTickets.map(ticket => <article className="support-ticket" key={ticket.id}>
    <header className="support-ticket-head"><div><b>Ticket #{ticket.id} · {ticket.customer_name}</b><small>{ticket.customer_phone} · To {ticket.recipient_name} · Updated {new Date(ticket.updated_at).toLocaleString()}</small></div><span className={`status ${ticket.status === 'open' ? 'status-ok' : ''}`}>{ticket.status}</span></header>
    <div className="support-ticket-messages">{ticket.messages.map(message => <div className={`support-ticket-message ${message.sender_role === user.role ? 'support-ticket-message--mine' : ''}`} key={message.id}><b>{message.sender_name} <small>· {new Date(message.created_at).toLocaleString()}</small></b><p>{message.message}</p></div>)}</div>
    {ticket.status === 'open' && <form className="support-ticket-reply" onSubmit={event => submitTicketReply(event, ticket.id)}><textarea required maxLength={2000} value={ticketReplies[ticket.id] || ''} onChange={event => setTicketReplies(current => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Write a reply..." /><Button type="submit"><Send size={15} /> Reply</Button></form>}
    {isOwner && <Button variant="secondary" onClick={() => onTicketStatusChange(ticket.id, ticket.status === 'open' ? 'closed' : 'open')}>{ticket.status === 'open' ? 'Close ticket' : 'Reopen ticket'}</Button>}
   </article>)}</div>}
  </div>
 </section>;
}
function roleLabel(role: User['role']) {
  return role === 'super_admin' ? 'Super Admin' : role === 'delivery_boy' ? 'Delivery Boy' : role === 'supplier' ? 'Supplier' : 'Customer';
}
function initials(name: string) {
  return name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
}
function PanelHead({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return <div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;
}
function QuickAction({
  icon,
  title,
  desc,
  onClick
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return <button className="quick-action" onClick={onClick}><Icon3D>{icon}</Icon3D><span><b>{title}</b><small>{desc}</small></span><ArrowRight size={16} /></button>;
}
function Toolbar({
  search,
  setSearch,
  placeholder
}: {
  search: string;
  setSearch: (v: string) => void;
  placeholder: string;
}) {
  return <div className="toolbar"><label className="search-input"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={placeholder} /></label></div>;
}
function CustomerTable({
  rows,
  onQr,
  onDeliver,
  showAssignment = false,
  boys = [],
  onAssign,
  actionLabel = 'Record delivery',
  hideCode = false,
  hideQr = false,
  hideAction = false,
  showDue = false,
  onDelete,
  showLoginManagement = false,
  onManageLogin
}: {
  rows: Customer[];
  onQr: (c: Customer) => void;
  onDeliver: (c: Customer) => void;
  showAssignment?: boolean;
  boys?: DeliveryBoy[];
  onAssign?: (id: number, boyId: string) => void;
  actionLabel?: string;
  hideCode?: boolean;
  hideQr?: boolean;
  hideAction?: boolean;
  showDue?: boolean;
  onDelete?: (customer: Customer) => void;
  showLoginManagement?: boolean;
  onManageLogin?: (customer: Customer) => void;
}) {
  return <div className="table-wrap"><table><thead><tr><th>Customer</th>{!hideCode && <th>Customer code</th>}<th>Contact & address</th>{showAssignment && <th>Delivery partner</th>}{showDue && <th>Due months</th>}{showLoginManagement && <th>Customer login</th>}{!hideQr && <th>QR code</th>}{(!hideAction || showLoginManagement) && <th className="table-actions-heading">Actions</th>}{onDelete && <th>Remove</th>}</tr></thead><tbody>{rows.map(c => <tr key={c.id}><td><div className="person"><span className="avatar">{initials(c.name)}</span><b>{c.name}</b></div></td>{!hideCode && <td><code>{c.customer_code?.slice(0, 8) || `MM-${c.id}`}</code></td>}<td><b>{c.phone || '—'}</b><small>{c.address || 'Address not added'}</small></td>{showAssignment && <td><select value={c.assigned_to || ''} onChange={e => onAssign?.(c.id, e.target.value)}><option value="">Unassigned</option>{boys.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>}{showDue && <td>{Number(c.due_count || 0) > 0 ? <span className="due-pill">{c.due_count} due</span> : <span className="status status-ok">Current</span>}</td>}{showLoginManagement && <td><span className={`status ${c.login_enabled ? 'status-ok' : ''}`}>{c.login_enabled ? 'Enabled' : 'Not set up'}</span><small>Username: {c.phone || 'Add phone'}</small></td>}{!hideQr && <td><button className="table-action" onClick={() => onQr(c)}><QrCode size={15} /> View QR</button></td>}{(!hideAction || showLoginManagement) && <td><div className="table-row-actions">{showLoginManagement && <Button variant="secondary" disabled={!c.phone} onClick={() => onManageLogin?.(c)}>{c.login_enabled ? 'Change password' : 'Set password'}</Button>}{!hideAction && <Button variant="secondary" onClick={() => onDeliver(c)}>{actionLabel}</Button>}</div></td>}{onDelete && <td><Button variant="danger" onClick={() => onDelete(c)}><Trash2 size={15} /> Delete</Button></td>}</tr>)}</tbody></table>{!rows.length && <Empty label="No matching customers" />}</div>;
}
function PaymentTable({
  rows
}: {
  rows: any[];
}) {
  return <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Method</th><th>Reference</th><th>Collected by</th><th>Date</th><th>Amount</th></tr></thead><tbody>{rows.map((p, i) => <tr key={p.id || i}><td><b>{p.customer_name || 'Customer'}</b></td><td>{p.payment_method}</td><td>{p.reference_note || '—'}</td><td>{p.recorded_by || '—'}</td><td>{String(p.paid_at || '').slice(0, 16).replace('T', ' ')}</td><td><b>{money(p.amount)}</b></td></tr>)}</tbody></table>{!rows.length && <Empty label="No payments recorded yet" />}</div>;
}
function DeliveryTable({
  rows
}: {
  rows: Delivery[];
}) {
  return <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Milk type</th><th>Quantity</th><th>Rate / L</th><th>Charge</th><th>Date & time</th><th>Status</th></tr></thead><tbody>{rows.map(d => <tr key={d.id}><td><div className="person"><span className="milk-dot"><Milk size={17} /></span><b>{d.customer_name || `Customer #${d.customer_id}`}</b></div></td><td>{d.milk_type === 'cow' ? 'Cow milk' : 'Buffalo milk'}</td><td>{Number(d.quantity_litres).toFixed(2)} L</td><td>{money(d.rate_per_litre)}</td><td><b>{money(d.amount)}</b></td><td>{d.delivered_at ? new Date(d.delivered_at).toLocaleString() : '—'}</td><td><span className="status status-ok"><Check size={12} /> Saved</span></td></tr>)}</tbody></table>{!rows.length && <Empty label="No delivery records found" />}</div>;
}
