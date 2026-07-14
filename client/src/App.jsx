import {
  Archive,
  BadgePercent,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  FileText,
  Home,
  LayoutDashboard,
  LogIn,
  LogOut,
  PackagePlus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  Truck,
  UserRound,
  UsersRound
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, formatMoney } from './api.js';

const adminNav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'store', label: 'Storefront', icon: ShoppingBag },
  { id: 'products', label: 'Products', icon: PackagePlus },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'orders', label: 'Orders', icon: Truck },
  { id: 'customers', label: 'Customers', icon: UsersRound },
  { id: 'discounts', label: 'Discounts', icon: BadgePercent },
  { id: 'cms', label: 'CMS', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings }
];

function useAsyncData(loader, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loader()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  return { data, setData, loading, error };
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('hoj_token') || '');
  const [user, setUser] = useState(null);
  const [view, setView] = useState(token ? 'dashboard' : 'store');
  const [notice, setNotice] = useState('');
  const [sessionId] = useState(() => {
    const existing = localStorage.getItem('hoj_session_id');
    if (existing) return existing;
    const next = `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('hoj_session_id', next);
    return next;
  });

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    api('/auth/me', { token })
      .then((payload) => setUser(payload.data))
      .catch(() => {
        localStorage.removeItem('hoj_token');
        setToken('');
        setUser(null);
      });
  }, [token]);

  const isAdmin = ['admin', 'manager'].includes(user?.role);
  const navItems = isAdmin ? adminNav : [
    { id: 'store', label: 'Storefront', icon: ShoppingBag },
    { id: 'login', label: 'Login', icon: LogIn }
  ];

  useEffect(() => {
    if (!isAdmin && !['store', 'login'].includes(view)) setView('store');
  }, [isAdmin, view]);

  function handleLogin(auth) {
    localStorage.setItem('hoj_token', auth.token);
    setToken(auth.token);
    setUser(auth.data);
    setView(auth.data.role === 'admin' ? 'dashboard' : 'store');
    setNotice('Signed in');
  }

  function logout() {
    localStorage.removeItem('hoj_token');
    setToken('');
    setUser(null);
    setView('store');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand-button" onClick={() => setView(isAdmin ? 'dashboard' : 'store')}>
          <Home size={22} />
          <span>
            <strong>House of Jaapa</strong>
            <small>Ecommerce Console</small>
          </span>
        </button>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'active' : ''}
                onClick={() => setView(item.id)}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        {token ? (
          <button className="ghost logout" onClick={logout} title="Sign out">
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        ) : null}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">House of Jaapa</p>
            <h1>{navItems.find((item) => item.id === view)?.label || 'Console'}</h1>
          </div>
          <div className="user-pill">
            <UserRound size={18} />
            <span>{user?.name || 'Guest'}</span>
          </div>
        </header>

        {notice ? (
          <button className="notice" onClick={() => setNotice('')} title="Dismiss">
            <Check size={16} />
            <span>{notice}</span>
          </button>
        ) : null}

        {view === 'login' && <Login onLogin={handleLogin} />}
        {view === 'store' && <Storefront sessionId={sessionId} token={token} setNotice={setNotice} />}
        {view === 'dashboard' && isAdmin && <Dashboard token={token} />}
        {view === 'products' && isAdmin && <Products token={token} setNotice={setNotice} />}
        {view === 'inventory' && isAdmin && <Inventory token={token} setNotice={setNotice} />}
        {view === 'orders' && isAdmin && <Orders token={token} setNotice={setNotice} />}
        {view === 'customers' && isAdmin && <Customers token={token} />}
        {view === 'discounts' && isAdmin && <Discounts token={token} setNotice={setNotice} />}
        {view === 'cms' && isAdmin && <Cms token={token} setNotice={setNotice} />}
        {view === 'settings' && isAdmin && <StoreSettings token={token} setNotice={setNotice} />}
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ email: 'admin@houseofjaapa.com', password: 'admin12345' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = await api('/auth/login', { method: 'POST', body: form });
      onLogin(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-layout">
      <form className="panel form-grid compact" onSubmit={submit}>
        <h2>Admin Login</h2>
        <label>
          Email
          <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" disabled={loading}>
          <LogIn size={18} />
          <span>{loading ? 'Signing in' : 'Sign in'}</span>
        </button>
      </form>
    </section>
  );
}

function Dashboard({ token }) {
  const { data, loading, error } = useAsyncData(() => api('/reports/dashboard', { token }), [token]);
  if (loading) return <Loading label="Loading dashboard" />;
  if (error) return <ErrorBox message={error} />;

  const dashboard = data.data;
  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric icon={BarChart3} label="Revenue" value={formatMoney(dashboard.sales.revenue)} />
        <Metric icon={ShoppingCart} label="Orders" value={dashboard.sales.order_count} />
        <Metric icon={PackagePlus} label="Products" value={dashboard.products.count} />
        <Metric icon={Archive} label="Low Stock" value={dashboard.low_stock.count} />
      </div>

      <div className="two-column">
        <Panel title="Recent Orders">
          <DataTable
            columns={['Order', 'Customer', 'Status', 'Total']}
            rows={dashboard.recent_orders.map((order) => [
              order.order_number,
              `${order.first_name || ''} ${order.last_name || ''}`.trim() || order.email || 'Guest',
              order.status,
              formatMoney(order.total)
            ])}
          />
        </Panel>
        <Panel title="Top Products">
          <DataTable
            columns={['Product', 'Units', 'Revenue']}
            rows={dashboard.top_products.map((product) => [product.title, product.units_sold, formatMoney(product.revenue)])}
          />
        </Panel>
      </div>
    </section>
  );
}

function Storefront({ sessionId, token, setNotice }) {
  const [refresh, setRefresh] = useState(0);
  const [coupon, setCoupon] = useState('JAAPA10');
  const [checkout, setCheckout] = useState({
    first_name: 'Anaya',
    last_name: 'Sharma',
    email: 'anaya@example.com',
    phone: '9876543210',
    line1: '14 Garden Road',
    city: 'Jaipur',
    state: 'Rajasthan',
    postal_code: '302001',
    payment_method: 'cod',
    terms_accepted: true
  });
  const products = useAsyncData(() => api('/products?status=active&limit=24', { token }), [refresh, token]);
  const cart = useAsyncData(() => api(`/cart?session_id=${sessionId}`, { token }), [refresh, sessionId, token]);

  async function addToCart(product) {
    const variant = product.variants?.[0];
    await api('/cart/items', {
      method: 'POST',
      token,
      body: {
        session_id: sessionId,
        product_id: product.id,
        variant_id: variant?.id,
        quantity: 1
      }
    });
    setNotice('Added to cart');
    setRefresh((value) => value + 1);
  }

  async function applyCoupon() {
    await api('/cart/discount', {
      method: 'POST',
      token,
      body: { session_id: sessionId, cart_id: cart.data?.data?.id, code: coupon }
    });
    setNotice('Discount applied');
    setRefresh((value) => value + 1);
  }

  async function placeOrder(event) {
    event.preventDefault();
    const body = {
      cart_id: cart.data?.data?.id,
      customer: {
        first_name: checkout.first_name,
        last_name: checkout.last_name,
        email: checkout.email,
        phone: checkout.phone
      },
      shipping_address: {
        full_name: `${checkout.first_name} ${checkout.last_name}`.trim(),
        phone: checkout.phone,
        line1: checkout.line1,
        city: checkout.city,
        state: checkout.state,
        country: 'India',
        postal_code: checkout.postal_code
      },
      payment_method: checkout.payment_method,
      terms_accepted: checkout.terms_accepted
    };
    const order = await api('/checkout', { method: 'POST', token, body });
    setNotice(`Order ${order.data.order_number} created`);
    setRefresh((value) => value + 1);
  }

  return (
    <section className="store-grid">
      <div className="stack">
        <div className="toolbar">
          <div className="search-box">
            <Search size={18} />
            <input placeholder="Search coming from product API filters" disabled />
          </div>
          <button className="ghost" onClick={() => setRefresh((value) => value + 1)} title="Refresh">
            <RefreshCw size={17} />
            <span>Refresh</span>
          </button>
        </div>
        {products.loading ? <Loading label="Loading products" /> : null}
        {products.error ? <ErrorBox message={products.error} /> : null}
        <div className="product-grid">
          {(products.data?.data || []).map((product) => (
            <article className="product-card" key={product.id}>
              <div className="product-image">
                {product.primary_image ? <img src={product.primary_image} alt={product.title} /> : <PackagePlus size={32} />}
              </div>
              <div>
                <p className="eyebrow">{product.category_name || 'Collection'}</p>
                <h3>{product.title}</h3>
                <p>{product.description?.slice(0, 110)}</p>
              </div>
              <div className="card-footer">
                <span className="price">{formatMoney(product.regular_price)}</span>
                <button className="primary icon-only-label" onClick={() => addToCart(product)} title="Add to cart">
                  <ShoppingCart size={17} />
                  <span>Add</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="panel checkout-panel">
        <h2>Cart</h2>
        {cart.loading ? <Loading label="Loading cart" /> : null}
        {(cart.data?.data?.items || []).map((item) => (
          <div className="cart-line" key={item.id}>
            <div>
              <strong>{item.product_title}</strong>
              <small>{item.variant_title || item.product_sku}</small>
            </div>
            <span>{item.quantity} x {formatMoney(item.unit_price)}</span>
          </div>
        ))}
        <div className="coupon-row">
          <input value={coupon} onChange={(event) => setCoupon(event.target.value)} />
          <button className="ghost" onClick={applyCoupon} title="Apply coupon">
            <Tag size={17} />
            <span>Apply</span>
          </button>
        </div>
        <Totals cart={cart.data?.data} />
        <form className="form-grid compact" onSubmit={placeOrder}>
          {['first_name', 'last_name', 'email', 'phone', 'line1', 'city', 'state', 'postal_code'].map((field) => (
            <label key={field}>
              {field.replaceAll('_', ' ')}
              <input value={checkout[field]} onChange={(event) => setCheckout({ ...checkout, [field]: event.target.value })} />
            </label>
          ))}
          <label>
            Payment
            <select value={checkout.payment_method} onChange={(event) => setCheckout({ ...checkout, payment_method: event.target.value })}>
              <option value="cod">Cash on Delivery</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="net_banking">Net Banking</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={checkout.terms_accepted}
              onChange={(event) => setCheckout({ ...checkout, terms_accepted: event.target.checked })}
            />
            <span>Terms accepted</span>
          </label>
          <button className="primary" disabled={!cart.data?.data?.items?.length}>
            <ChevronRight size={18} />
            <span>Place order</span>
          </button>
        </form>
      </aside>
    </section>
  );
}

function Products({ token, setNotice }) {
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState({
    title: '',
    sku: '',
    regular_price: 2499,
    initial_stock: 10,
    category_name: 'Women',
    brand_name: 'House of Jaapa',
    vendor_name: 'Jaapa Studio',
    status: 'active',
    image_url: '',
    tags: 'new'
  });
  const { data, loading, error } = useAsyncData(() => api('/products?limit=100', { token }), [refresh, token]);

  async function createProduct(event) {
    event.preventDefault();
    const sku = form.sku || `HOJ-${Date.now()}`;
    await api('/products', {
      method: 'POST',
      token,
      body: {
        title: form.title,
        sku,
        regular_price: Number(form.regular_price),
        status: form.status,
        category_name: form.category_name,
        brand_name: form.brand_name,
        vendor_name: form.vendor_name,
        tags: form.tags,
        variants: [{ title: 'Default', sku, initial_stock: Number(form.initial_stock) }],
        media: form.image_url ? [{ type: 'image', url: form.image_url, alt_text: form.title }] : []
      }
    });
    setNotice('Product created');
    setForm({ ...form, title: '', sku: '', image_url: '' });
    setRefresh((value) => value + 1);
  }

  async function archiveProduct(id) {
    await api(`/products/${id}`, { method: 'DELETE', token });
    setNotice('Product archived');
    setRefresh((value) => value + 1);
  }

  return (
    <section className="two-column wide-left">
      <Panel title="Products">
        {loading ? <Loading label="Loading products" /> : null}
        {error ? <ErrorBox message={error} /> : null}
        <DataTable
          columns={['Product', 'SKU', 'Status', 'Stock', 'Price', '']}
          rows={(data?.data || []).map((product) => [
            product.title,
            product.sku,
            product.status,
            product.available_stock,
            formatMoney(product.regular_price),
            <button className="icon-button danger" onClick={() => archiveProduct(product.id)} title="Archive product" key={product.id}>
              <Archive size={16} />
            </button>
          ])}
        />
      </Panel>
      <Panel title="Add Product">
        <form className="form-grid compact" onSubmit={createProduct}>
          <TextInput label="Title" value={form.title} setValue={(value) => setForm({ ...form, title: value })} required />
          <TextInput label="SKU" value={form.sku} setValue={(value) => setForm({ ...form, sku: value })} />
          <NumberInput label="Price" value={form.regular_price} setValue={(value) => setForm({ ...form, regular_price: value })} />
          <NumberInput label="Stock" value={form.initial_stock} setValue={(value) => setForm({ ...form, initial_stock: value })} />
          <TextInput label="Category" value={form.category_name} setValue={(value) => setForm({ ...form, category_name: value })} />
          <TextInput label="Image URL" value={form.image_url} setValue={(value) => setForm({ ...form, image_url: value })} />
          <button className="primary">
            <Save size={17} />
            <span>Create</span>
          </button>
        </form>
      </Panel>
    </section>
  );
}

function Inventory({ token, setNotice }) {
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [delta, setDelta] = useState(1);
  const { data, loading, error } = useAsyncData(() => api('/inventory', { token }), [refresh, token]);
  const rows = data?.data || [];
  const selected = rows.find((row) => String(row.id) === String(selectedId)) || rows[0];

  async function adjust(event) {
    event.preventDefault();
    if (!selected) return;
    await api('/inventory/adjust', {
      method: 'POST',
      token,
      body: {
        product_id: selected.product_id,
        variant_id: selected.variant_id,
        warehouse_id: selected.warehouse_id,
        change_quantity: Number(delta),
        movement_type: 'adjustment',
        note: 'Manual admin adjustment'
      }
    });
    setNotice('Inventory adjusted');
    setRefresh((value) => value + 1);
  }

  return (
    <section className="two-column wide-left">
      <Panel title="Inventory">
        {loading ? <Loading label="Loading inventory" /> : null}
        {error ? <ErrorBox message={error} /> : null}
        <DataTable
          columns={['Product', 'Variant', 'Warehouse', 'Qty', 'Reserved', 'Available']}
          rows={rows.map((item) => [
            item.product_title,
            item.variant_title || 'Default',
            item.warehouse_code,
            item.quantity,
            item.reserved_quantity,
            item.available_quantity
          ])}
        />
      </Panel>
      <Panel title="Adjust Stock">
        <form className="form-grid compact" onSubmit={adjust}>
          <label>
            Item
            <select value={selectedId || selected?.id || ''} onChange={(event) => setSelectedId(event.target.value)}>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>{row.product_title} / {row.variant_title || 'Default'}</option>
              ))}
            </select>
          </label>
          <NumberInput label="Change" value={delta} setValue={setDelta} />
          <button className="primary">
            <SlidersHorizontal size={17} />
            <span>Adjust</span>
          </button>
        </form>
      </Panel>
    </section>
  );
}

function Orders({ token, setNotice }) {
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error } = useAsyncData(() => api('/orders', { token }), [refresh, token]);

  async function markShipped(id) {
    await api(`/orders/${id}/status`, {
      method: 'PATCH',
      token,
      body: { status: 'shipped', fulfillment_status: 'fulfilled' }
    });
    setNotice('Order updated');
    setRefresh((value) => value + 1);
  }

  return (
    <Panel title="Orders">
      {loading ? <Loading label="Loading orders" /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <DataTable
        columns={['Order', 'Customer', 'Status', 'Payment', 'Fulfillment', 'Total', '']}
        rows={(data?.data || []).map((order) => [
          order.order_number,
          `${order.first_name || ''} ${order.last_name || ''}`.trim() || order.email || 'Guest',
          order.status,
          order.payment_status,
          order.fulfillment_status,
          formatMoney(order.total),
          <button className="icon-button" onClick={() => markShipped(order.id)} title="Mark shipped" key={order.id}>
            <Truck size={16} />
          </button>
        ])}
      />
    </Panel>
  );
}

function Customers({ token }) {
  const { data, loading, error } = useAsyncData(() => api('/customers', { token }), [token]);
  return (
    <Panel title="Customers">
      {loading ? <Loading label="Loading customers" /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <DataTable
        columns={['Name', 'Email', 'Group', 'Orders', 'Lifetime Value', 'Points']}
        rows={(data?.data || []).map((customer) => [
          `${customer.first_name} ${customer.last_name || ''}`.trim(),
          customer.email,
          customer.group_name,
          customer.order_count,
          formatMoney(customer.lifetime_value),
          customer.reward_points
        ])}
      />
    </Panel>
  );
}

function Discounts({ token, setNotice }) {
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState({ code: '', title: '', discount_type: 'percentage', value: 10, min_order_value: 0 });
  const { data, loading, error } = useAsyncData(() => api('/discounts', { token }), [refresh, token]);

  async function createDiscount(event) {
    event.preventDefault();
    await api('/discounts', { method: 'POST', token, body: form });
    setNotice('Discount created');
    setForm({ ...form, code: '', title: '' });
    setRefresh((value) => value + 1);
  }

  return (
    <section className="two-column wide-left">
      <Panel title="Discounts">
        {loading ? <Loading label="Loading discounts" /> : null}
        {error ? <ErrorBox message={error} /> : null}
        <DataTable
          columns={['Code', 'Title', 'Type', 'Value', 'Min Order', 'Used']}
          rows={(data?.data || []).map((discount) => [
            discount.code || 'Automatic',
            discount.title,
            discount.discount_type,
            discount.discount_type === 'percentage' ? `${discount.value}%` : formatMoney(discount.value),
            formatMoney(discount.min_order_value),
            discount.used_count
          ])}
        />
      </Panel>
      <Panel title="Add Discount">
        <form className="form-grid compact" onSubmit={createDiscount}>
          <TextInput label="Code" value={form.code} setValue={(value) => setForm({ ...form, code: value.toUpperCase() })} />
          <TextInput label="Title" value={form.title} setValue={(value) => setForm({ ...form, title: value })} required />
          <label>
            Type
            <select value={form.discount_type} onChange={(event) => setForm({ ...form, discount_type: event.target.value })}>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
              <option value="free_shipping">Free shipping</option>
            </select>
          </label>
          <NumberInput label="Value" value={form.value} setValue={(value) => setForm({ ...form, value })} />
          <NumberInput label="Min Order" value={form.min_order_value} setValue={(value) => setForm({ ...form, min_order_value: value })} />
          <button className="primary">
            <Save size={17} />
            <span>Create</span>
          </button>
        </form>
      </Panel>
    </section>
  );
}

function Cms({ token, setNotice }) {
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState({ title: '', body: '', status: 'published' });
  const { data, loading, error } = useAsyncData(() => api('/cms/pages', { token }), [refresh, token]);

  async function createPage(event) {
    event.preventDefault();
    await api('/cms/pages', { method: 'POST', token, body: form });
    setNotice('Page created');
    setForm({ title: '', body: '', status: 'published' });
    setRefresh((value) => value + 1);
  }

  return (
    <section className="two-column wide-left">
      <Panel title="Pages">
        {loading ? <Loading label="Loading pages" /> : null}
        {error ? <ErrorBox message={error} /> : null}
        <DataTable
          columns={['Title', 'Slug', 'Type', 'Status']}
          rows={(data?.data || []).map((page) => [page.title, page.slug, page.page_type, page.status])}
        />
      </Panel>
      <Panel title="Add Page">
        <form className="form-grid compact" onSubmit={createPage}>
          <TextInput label="Title" value={form.title} setValue={(value) => setForm({ ...form, title: value })} required />
          <label>
            Body
            <textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <button className="primary">
            <Save size={17} />
            <span>Create</span>
          </button>
        </form>
      </Panel>
    </section>
  );
}

function StoreSettings({ token, setNotice }) {
  const { data, setData, loading, error } = useAsyncData(() => api('/settings', { token }), [token]);
  const [json, setJson] = useState('');

  useEffect(() => {
    if (data?.data?.store) setJson(JSON.stringify(data.data.store, null, 2));
  }, [data]);

  async function save(event) {
    event.preventDefault();
    const next = JSON.parse(json);
    const payload = await api('/settings/store', { method: 'PUT', token, body: { value: next } });
    setData({ data: { ...data.data, store: payload.data.value } });
    setNotice('Settings saved');
  }

  return (
    <Panel title="Store Settings">
      {loading ? <Loading label="Loading settings" /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <form className="form-grid" onSubmit={save}>
        <label>
          Store JSON
          <textarea className="code-area" value={json} onChange={(event) => setJson(event.target.value)} />
        </label>
        <button className="primary">
          <Save size={17} />
          <span>Save</span>
        </button>
      </form>
    </Panel>
  );
}

function Totals({ cart }) {
  const totals = cart?.totals || { subtotal: 0, discount_total: 0, tax_total: 0 };
  const grandTotal = Number(totals.subtotal) - Number(totals.discount_total) + Number(totals.tax_total);
  return (
    <div className="totals">
      <span>Subtotal <strong>{formatMoney(totals.subtotal)}</strong></span>
      <span>Discount <strong>{formatMoney(totals.discount_total)}</strong></span>
      <span>Tax <strong>{formatMoney(totals.tax_total)}</strong></span>
      <span className="grand">Cart Total <strong>{formatMoney(grandTotal)}</strong></span>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <article className="metric-card">
      <Icon size={22} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, children }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DataTable({ columns, rows }) {
  if (!rows?.length) return <p className="muted">No records yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextInput({ label, value, setValue, required = false }) {
  return (
    <label>
      {label}
      <input value={value} required={required} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

function NumberInput({ label, value, setValue }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

function Loading({ label }) {
  return <p className="muted">{label}...</p>;
}

function ErrorBox({ message }) {
  return <p className="error">{message}</p>;
}

export default App;

