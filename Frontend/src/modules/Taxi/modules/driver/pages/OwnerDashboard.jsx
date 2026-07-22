import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Bus,
  Car,
  CreditCard,
  IndianRupee,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  TrendingUp,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../../../shared/context/SettingsContext';
import DriverBottomNav from '../../shared/components/DriverBottomNav';
import { getOwnerFleetDashboard } from '../services/registrationService';

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

const formatRelativeDate = (value) => {
  if (!value) {
    return 'Recently';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const statusTone = (value = '') => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'approved' || normalized === 'completed' || normalized === 'active') {
    return 'bg-emerald-50 text-emerald-600';
  }
  if (normalized === 'pending' || normalized === 'accepted' || normalized === 'ongoing') {
    return 'bg-amber-50 text-amber-600';
  }
  if (normalized === 'cancelled' || normalized === 'rejected' || normalized === 'inactive') {
    return 'bg-rose-50 text-rose-600';
  }
  return 'bg-slate-100 text-slate-600';
};

const StatCard = ({ icon, label, value, sub, tone = 'slate' }) => {
  const toneClass =
    tone === 'emerald'
      ? 'from-emerald-500 to-teal-500 text-white'
      : tone === 'blue'
        ? 'from-blue-600 to-indigo-600 text-white'
        : tone === 'amber'
          ? 'from-amber-500 to-primary-orange/50 text-white'
          : 'from-slate-900 to-slate-800 text-white';

  return (
    <div className={`rounded-[28px] bg-gradient-to-br ${toneClass} p-5 shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-xl active:scale-98`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/65">{label}</p>
          <p className="mt-2 text-[28px] font-black tracking-tight leading-none">{value}</p>
          {sub ? <p className="mt-2 text-[11px] font-bold text-white/75">{sub}</p> : null}
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white shrink-0">
          {icon}
        </div>
      </div>
    </div>
  );
};

const OwnerDashboard = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = async ({ silent = false } = {}) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError('');

    try {
      const response = await getOwnerFleetDashboard();
      const payload = response?.data?.data || response?.data || response;
      setDashboard(payload);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Unable to load owner dashboard');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const profile = dashboard?.profile || {};
  const fleet = dashboard?.fleet || {};
  const bookings = dashboard?.bookings || {};
  const earnings = dashboard?.earnings || {};
  const serviceLocation = dashboard?.serviceLocation || null;
  const recentDrivers = dashboard?.recentDrivers || [];
  const recentVehicles = dashboard?.recentVehicles || [];
  const recentBusBookings = dashboard?.recentBusBookings || [];
  const busOverview = dashboard?.busOverview || {};
  const recentRides = dashboard?.recentRides || [];
  const transportBreakdown = dashboard?.transportBreakdown || [];
  const busEnabled = String(settings.transportRide?.enable_bus_service || '0') === '1';

  const businessSubtitle = useMemo(() => {
    const ownerName = profile.ownerName || profile.companyName || 'Owner';
    const serviceName = serviceLocation?.name || profile.city || 'Service area';
    return `${ownerName} • ${serviceName}`;
  }, [profile.city, profile.companyName, profile.ownerName, serviceLocation?.name]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb] pb-32">
      <div className="mx-auto max-w-lg px-5 pt-10">
        <header className="rounded-[32px] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-5 py-6 text-white shadow-2xl transition-all">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">Owner Dashboard</p>
              <h1 className="mt-2 text-[28px] font-black tracking-tight leading-none truncate">
                {profile.companyName || profile.ownerName || 'Fleet Business'}
              </h1>
              <p className="mt-2 text-[12px] font-bold text-white/70">{businessSubtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => loadDashboard({ silent: true })}
              disabled={isRefreshing}
              className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-white disabled:opacity-60 transition-transform active:scale-90"
              aria-label="Refresh dashboard"
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">Wallet</p>
              <p className="mt-2 text-[20px] font-black">{money(earnings.walletBalance)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">Today Earnings</p>
              <p className="mt-2 text-[20px] font-black">{money(earnings.todayOwnerEarnings)}</p>
            </div>
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50 px-4 py-4 text-[12px] font-bold text-rose-600">
            {error}
          </div>
        ) : null}

        <section className="mt-5 grid grid-cols-2 gap-3">
          <StatCard
            icon={<Users size={22} />}
            label="Fleet Drivers"
            value={fleet.totalDrivers || 0}
            sub={`${fleet.onlineDrivers || 0} online • ${fleet.busyDrivers || 0} on trip`}
            tone="blue"
          />
          <StatCard
            icon={<Car size={22} />}
            label="Fleet Vehicles"
            value={fleet.totalVehicles || 0}
            sub={`${fleet.approvedVehicles || 0} approved • ${fleet.pendingVehicles || 0} pending`}
            tone="emerald"
          />
          <StatCard
            icon={<Briefcase size={22} />}
            label="Total Bookings"
            value={bookings.total || 0}
            sub={`${bookings.active || 0} active right now`}
            tone="amber"
          />
          <StatCard
            icon={<IndianRupee size={22} />}
            label="Gross Revenue"
            value={money(earnings.grossRevenue)}
            sub={`${money(earnings.ownerEarnings)} net driver earnings`}
          />
        </section>

        {busEnabled ? (
          <>
            <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Bus Business</p>
                  <h2 className="mt-1 text-[20px] font-black text-slate-950">Owner bus snapshot</h2>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/taxi/owner/bus-service')}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-[11px] font-black text-white active:scale-95 transition-transform"
                >
                  <Bus size={14} />
                  Open Bus
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Buses</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{busOverview.totalBuses || 0}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">{busOverview.activeBuses || 0} active</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bus Bookings</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{busOverview.totalBookings || 0}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">{busOverview.upcomingBookings || 0} upcoming</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confirmed</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{busOverview.confirmedBookings || 0}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">live paid seats</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bus Revenue</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{money(busOverview.grossRevenue)}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">pending + confirmed</p>
                </div>
              </div>
            </section>

            <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Bus Bookings</p>
                  <h2 className="mt-1 text-[20px] font-black text-slate-950">Latest seat reservations</h2>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/taxi/owner/bus-bookings')}
                  className="text-[11px] font-black text-blue-600 active:opacity-70"
                >
                  View all
                </button>
              </div>
              <div className="mt-4 flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth -mx-5 px-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                {recentBusBookings.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-6 text-[12px] font-bold text-slate-400 w-full text-center">
                    No bus bookings found yet.
                  </div>
                ) : (
                  recentBusBookings.map((booking) => (
                    <div key={booking.id} className="w-[85%] sm:w-[320px] shrink-0 snap-start bg-slate-50 border border-slate-100 rounded-3xl p-5 hover:bg-slate-100/50 transition-all flex flex-col justify-between shadow-sm">
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[13px] font-black text-slate-900 truncate">
                            {booking.busService?.busName || booking.routeSnapshot?.busName || 'Bus Service'}
                          </p>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest shrink-0 ${statusTone(booking.status)}`}>
                            {booking.status || 'pending'}
                          </span>
                        </div>
                        <p className="mt-2 text-[11px] font-bold text-slate-500">
                          {booking.routeSnapshot?.originCity || 'Origin'} to {booking.routeSnapshot?.destinationCity || 'Destination'}
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-slate-400">
                          {booking.passenger?.name || 'Passenger'} • {booking.seatLabels?.length || booking.seatIds?.length || 0} seats • {booking.travelDate || '-'}
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-200/50 flex items-center justify-between">
                        <p className="text-[10px] font-bold text-slate-400">{formatRelativeDate(booking.createdAt)}</p>
                        <p className="text-[13px] font-black text-emerald-600">{money(booking.amount)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Business Overview</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Live business snapshot</h2>
            </div>
            <TrendingUp size={20} className="text-emerald-500" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Completed</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{bookings.completed || 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cancelled</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{bookings.cancelled || 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cash Trips</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{earnings.cashTrips || 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Online Trips</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{earnings.onlineTrips || 0}</p>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">From DB</p>
          <h2 className="mt-1 text-[20px] font-black text-slate-950">Business details</h2>
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3">
              <MapPin size={18} className="mt-0.5 text-blue-500" />
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Service Location</p>
                <p className="mt-1 text-[14px] font-black text-slate-900">{serviceLocation?.name || '-'}</p>
                <p className="mt-1 text-[12px] font-semibold text-slate-500">{serviceLocation?.address || profile.address || 'Address not updated'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Owner</p>
                <p className="mt-1 text-[14px] font-black text-slate-900 truncate">{profile.ownerName || '-'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Transport</p>
                <p className="mt-1 text-[14px] font-black text-slate-900 capitalize">{profile.transportType || '-'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Phone</p>
                <p className="mt-1 text-[14px] font-black text-slate-900">{profile.phone || '-'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Status</p>
                <p className="mt-1 text-[14px] font-black text-slate-900 capitalize">{profile.status || '-'}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Transport Mix</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Bookings by module</h2>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {transportBreakdown.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-[12px] font-bold text-slate-400">
                No booking data yet.
              </div>
            ) : (
              transportBreakdown.map((item) => (
                <div key={item.transportType} className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-black text-slate-900 capitalize">{item.transportType}</p>
                    <p className="text-[12px] font-black text-emerald-600">{money(item.earnings)}</p>
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">
                    {item.trips} trips • {item.completedTrips} completed
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Drivers</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Fleet team</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/taxi/owner/manage-drivers')}
              className="text-[11px] font-black text-blue-600 active:opacity-70"
            >
              View all
            </button>
          </div>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth -mx-5 px-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            {recentDrivers.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-6 text-[12px] font-bold text-slate-400 w-full text-center">
                No drivers added yet.
              </div>
            ) : (
              recentDrivers.map((driver) => (
                <div key={driver.id} className="w-[75%] sm:w-[260px] shrink-0 snap-start bg-slate-50 border border-slate-100 rounded-3xl p-5 hover:bg-slate-100/50 transition-all flex flex-col justify-between shadow-sm">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-black text-slate-900 truncate">{driver.name || 'Driver'}</p>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest shrink-0 ${statusTone(driver.status)}`}>
                        {driver.status || 'pending'}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] font-bold text-slate-500">{driver.phone || '-'}</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-400">{driver.city || 'No city'}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-200/50 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${driver.isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <p className="text-[11px] font-bold text-slate-500">
                        {driver.isOnRide ? 'On trip' : driver.isOnline ? 'Online' : 'Offline'}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Vehicles</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Fleet inventory</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/taxi/owner/vehicle-fleet')}
              className="text-[11px] font-black text-blue-600 active:opacity-70"
            >
              View all
            </button>
          </div>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth -mx-5 px-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            {recentVehicles.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-6 text-[12px] font-bold text-slate-400 w-full text-center">
                No vehicles added yet.
              </div>
            ) : (
              recentVehicles.map((vehicle) => (
                <div key={vehicle.id} className="w-[75%] sm:w-[260px] shrink-0 snap-start bg-slate-50 border border-slate-100 rounded-3xl p-5 hover:bg-slate-100/50 transition-all flex flex-col justify-between shadow-sm">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-black text-slate-900 truncate">
                        {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleTypeName || 'Vehicle'}
                      </p>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest shrink-0 ${statusTone(vehicle.status)}`}>
                        {vehicle.status || 'pending'}
                      </span>
                    </div>
                    <p className="mt-2 text-[12px] font-black text-slate-800">{vehicle.number || '-'}</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-400 capitalize">{vehicle.color || 'No color'} • {vehicle.transportType || 'taxi'}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Bookings</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Latest ride activity</h2>
            </div>
          </div>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth -mx-5 px-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            {recentRides.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-6 text-[12px] font-bold text-slate-400 w-full text-center">
                No bookings found yet.
              </div>
            ) : (
              recentRides.map((ride) => (
                <div key={ride.id} className="w-[85%] sm:w-[320px] shrink-0 snap-start bg-slate-50 border border-slate-100 rounded-3xl p-5 hover:bg-slate-100/50 transition-all flex flex-col justify-between shadow-sm">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-black text-slate-900 capitalize">
                        {ride.transportType || 'taxi'} • {ride.driver?.name || 'Driver not assigned'}
                      </p>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest shrink-0 ${statusTone(ride.status)}`}>
                        {ride.status || 'pending'}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-slate-500 truncate"><strong className="text-slate-700">P:</strong> {ride.pickupAddress || '-'}</p>
                    <p className="mt-1 text-[11px] font-medium text-slate-500 truncate"><strong className="text-slate-700">D:</strong> {ride.dropAddress || '-'}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-200/50 flex items-center justify-between">
                    <p className="text-[10px] font-bold text-slate-400">{formatRelativeDate(ride.createdAt)}</p>
                    <p className="text-[13px] font-black text-emerald-600">{money(ride.earnings || ride.fare)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => navigate('/taxi/owner/manage-drivers')}
            className="flex items-center justify-between rounded-[26px] bg-white px-4 py-4 shadow-sm transition-all hover:scale-[1.02] active:scale-95"
          >
            <div className="text-left">
              <p className="text-[11px] font-black text-slate-900">Manage Drivers</p>
              <p className="mt-1 text-[10px] font-bold text-slate-400">Edit your team</p>
            </div>
            <ArrowRight size={16} className="text-slate-300 animate-pulse" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/taxi/owner/vehicle-fleet')}
            className="flex items-center justify-between rounded-[26px] bg-white px-4 py-4 shadow-sm transition-all hover:scale-[1.02] active:scale-95"
          >
            <div className="text-left">
              <p className="text-[11px] font-black text-slate-900">Manage Fleet</p>
              <p className="mt-1 text-[10px] font-bold text-slate-400">Update vehicles</p>
            </div>
            <ArrowRight size={16} className="text-slate-300 animate-pulse" />
          </button>
        </div>
      </div>

      <DriverBottomNav />
    </div>
  );
};

export default OwnerDashboard;
