import React from "react";
// Pilot Ops Admin — Aircraft & battery registry
// CRUD for airframes and batteries. This is where new equipment is registered.
const { useState: aaUseState, useMemo: aaUseMemo } = React;

function AdminAircraftView() {
  const toast = useToast();
  const sb = window.__supabase;
  const [tab, setTab] = aaUseState("aircraft");
  // Seed from the DB-backed store globals; mutations write back to Supabase.
  const [aircraftList, setAircraftList] = aaUseState(() => AIRCRAFT);
  const [batteryList, setBatteryList] = aaUseState(() => BATTERIES);

  const [editingAc, setEditingAc] = aaUseState(null);
  const [editingBat, setEditingBat] = aaUseState(null);
  const [search, setSearch] = aaUseState("");

  async function saveAircraft(ac) {
    const row = {
      code: ac.id, model: ac.model, serial: ac.serial, payload: ac.payload,
      in_service: ac.lastService || null, next_service: ac.nextService || null,
    };
    if (ac.dbId) {
      const { error } = await sb.from("aircraft").update(row).eq("id", ac.dbId);
      if (error) return toast({ kind: "warn", title: "Save failed", msg: error.message });
      setAircraftList(prev => prev.map(a => a.id === ac.id ? { ...a, ...ac } : a));
      toast({ kind: "success", title: "Aircraft updated", msg: ac.id });
    } else {
      const { data, error } = await sb.from("aircraft").insert({ ...row, status: "ready" }).select().single();
      if (error) return toast({ kind: "warn", title: "Register failed", msg: error.message });
      setAircraftList(prev => [{ ...ac, dbId: data.id, hours: 0, flights: 0, cycles: 0, status: "ready", battery: 100 }, ...prev]);
      toast({ kind: "success", title: "Aircraft registered", msg: `${ac.id} added to fleet` });
    }
    setEditingAc(null);
  }
  async function retireAircraft(id) {
    if (!confirm(`Retire ${id}? Pilots will no longer be able to assign it to flights.`)) return;
    const a = aircraftList.find(x => x.id === id);
    if (a?.dbId) await sb.from("aircraft").update({ status: "grounded" }).eq("id", a.dbId);
    setAircraftList(prev => prev.map(x => x.id === id ? { ...x, status: "grounded", alert: "Retired by admin" } : x));
    toast({ kind: "info", title: "Aircraft retired", msg: id });
  }
  async function deleteAircraft(id) {
    if (!confirm(`Permanently delete ${id} from the registry? This cannot be undone.`)) return;
    const a = aircraftList.find(x => x.id === id);
    if (a?.dbId) await sb.from("aircraft").delete().eq("id", a.dbId);
    setAircraftList(prev => prev.filter(x => x.id !== id));
    toast({ kind: "info", title: "Aircraft deleted", msg: id });
  }

  async function saveBattery(b) {
    const acRow = aircraftList.find(a => a.id === b.aircraft);
    const row = { code: b.id, aircraft_id: acRow?.dbId || null, capacity_mah: b.capacity, cycle_rating: b.maxCycles };
    if (b.dbId) {
      const { error } = await sb.from("batteries").update(row).eq("id", b.dbId);
      if (error) return toast({ kind: "warn", title: "Save failed", msg: error.message });
      setBatteryList(prev => prev.map(x => x.id === b.id ? { ...x, ...b } : x));
      toast({ kind: "success", title: "Battery updated", msg: b.id });
    } else {
      const { data, error } = await sb.from("batteries").insert({ ...row, status: "charged", health: 100, charge: 100 }).select().single();
      if (error) return toast({ kind: "warn", title: "Register failed", msg: error.message });
      setBatteryList(prev => [{ ...b, dbId: data.id, cycles: 0, health: 100, charge: 100, temp: 22, status: "charged" }, ...prev]);
      toast({ kind: "success", title: "Battery registered", msg: `${b.id} added` });
    }
    setEditingBat(null);
  }
  async function deleteBattery(id) {
    if (!confirm(`Delete ${id}?`)) return;
    const b = batteryList.find(x => x.id === id);
    if (b?.dbId) await sb.from("batteries").delete().eq("id", b.dbId);
    setBatteryList(prev => prev.filter(x => x.id !== id));
    toast({ kind: "info", title: "Battery deleted", msg: id });
  }

  const filteredAc = aircraftList.filter(a => !search || (a.id + a.model + (a.serial || "")).toLowerCase().includes(search.toLowerCase()));
  const filteredBat = batteryList.filter(b => !search || (b.id + b.aircraft).toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="main-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Aircraft registry</h1>
          <div className="page-sub">Register, edit, and retire airframes and batteries. {aircraftList.length} aircraft · {batteryList.length} batteries.</div>
        </div>
        <div className="page-actions">
          {tab === "aircraft" && (
            <button className="btn btn-primary" onClick={() => setEditingAc({ _new: true, id: nextId("UAV", aircraftList), model: "Skyhawk 6X", payload: "EO/IR", serial: "", location: "Hangar Alpha", assignedPilot: "—", lastService: new Date().toISOString().slice(0,10), nextService: "", serviceIn: 90 })}>
              <Icon name="plus" size={14}/> Register new aircraft
            </button>
          )}
          {tab === "batteries" && (
            <button className="btn btn-primary" onClick={() => setEditingBat({ _new: true, id: nextBatId(batteryList, aircraftList[0]?.id), aircraft: aircraftList[0]?.id || "", capacity: 5900, maxCycles: 500, lastCharge: "—" })}>
              <Icon name="plus" size={14}/> Register new battery
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 4 }}>
            <TabBtn k="aircraft" cur={tab} onClick={setTab} ic="drone" l="Aircraft" c={aircraftList.length}/>
            <TabBtn k="batteries" cur={tab} onClick={setTab} ic="battery" l="Batteries" c={batteryList.length}/>
          </div>
          <div className="search-input" style={{ marginLeft: "auto", width: 260, height: 32 }}>
            <Icon name="search" size={13}/>
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder={tab === "aircraft" ? "Search ID, model, serial…" : "Search battery, aircraft…"}
                   style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: "var(--text)", fontSize: 12.5 }}/>
          </div>
        </div>

        {tab === "aircraft" && (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Aircraft</th>
                  <th>Serial</th>
                  <th>Payload</th>
                  <th>Location</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th style={{ textAlign: "right" }}>Cycles</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredAc.map(a => {
                  const tone = a.status === "ready" ? "var(--success)" : a.status === "grounded" ? "var(--danger)" : "var(--warning)";
                  return (
                    <tr key={a.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}>
                            <Icon name="drone" size={15}/>
                          </div>
                          <div>
                            <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{a.id}</div>
                            <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{a.model}</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>{a.serial}</td>
                      <td style={{ fontSize: 12.5 }}>{a.payload}</td>
                      <td style={{ fontSize: 12.5 }}>{a.location}</td>
                      <td className="mono tabular" style={{ textAlign: "right", fontSize: 12 }}>{(a.hours || 0).toFixed(0)}</td>
                      <td className="mono tabular" style={{ textAlign: "right", fontSize: 12 }}>{a.cycles || 0}</td>
                      <td>
                        <span className="badge" style={{ background: `color-mix(in oklab, ${tone} 12%, transparent)`, color: tone, borderColor: `color-mix(in oklab, ${tone} 30%, transparent)`, textTransform: "capitalize" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: tone }}/> {a.status}
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditingAc(a)} title="Edit"><Icon name="edit" size={12}/></button>
                          <button className="btn btn-sm btn-ghost" onClick={() => retireAircraft(a.id)} title="Retire"><Icon name="warn" size={12}/></button>
                          <button className="btn btn-sm btn-ghost" onClick={() => deleteAircraft(a.id)} title="Delete"><Icon name="trash" size={12}/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredAc.length === 0 && <EmptyState onAdd={() => setEditingAc({ _new: true, id: nextId("UAV", aircraftList), model: "Skyhawk 6X", payload: "EO/IR", serial: "", location: "Hangar Alpha", assignedPilot: "—" })}/>}
          </div>
        )}

        {tab === "batteries" && (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Battery ID</th>
                  <th>Aircraft</th>
                  <th style={{ textAlign: "right" }}>Capacity</th>
                  <th style={{ textAlign: "right" }}>Cycles</th>
                  <th style={{ textAlign: "right" }}>Health</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredBat.map(b => {
                  const tone = b.status === "ready" ? "var(--success)" : b.status === "retire" ? "var(--danger)" : "var(--warning)";
                  return (
                    <tr key={b.id}>
                      <td className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{b.id}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{b.aircraft || <span className="muted">— unassigned —</span>}</td>
                      <td className="mono tabular" style={{ textAlign: "right", fontSize: 12 }}>{b.capacity.toLocaleString()} mAh</td>
                      <td className="mono tabular" style={{ textAlign: "right", fontSize: 12 }}>{b.cycles} / {b.maxCycles}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                          <div style={{ width: 60, height: 5, background: "var(--bg-muted)", borderRadius: 3 }}>
                            <div style={{ width: `${b.health}%`, height: "100%", background: b.health > 85 ? "var(--success)" : b.health > 70 ? "var(--warning)" : "var(--danger)", borderRadius: 3 }}/>
                          </div>
                          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{b.health}%</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{ background: `color-mix(in oklab, ${tone} 12%, transparent)`, color: tone, borderColor: `color-mix(in oklab, ${tone} 30%, transparent)`, textTransform: "capitalize" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: tone }}/> {b.status}
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditingBat(b)} title="Edit"><Icon name="edit" size={12}/></button>
                          <button className="btn btn-sm btn-ghost" onClick={() => deleteBattery(b.id)} title="Delete"><Icon name="trash" size={12}/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit / register aircraft */}
      {editingAc && (
        <Modal open onClose={() => setEditingAc(null)}
               title={editingAc._new ? "Register new aircraft" : `Edit ${editingAc.id}`}
               subtitle={editingAc._new ? "Add a new airframe to the fleet" : "Update aircraft details"}
               icon="drone" size="lg"
               footer={<>
                 <button className="btn" onClick={() => setEditingAc(null)}>Cancel</button>
                 <button className="btn btn-primary" onClick={() => saveAircraft(editingAc)}>
                   <Icon name="check" size={14}/> {editingAc._new ? "Register aircraft" : "Save changes"}
                 </button>
               </>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Fld label="Aircraft ID" hint="Auto-generated — editable">
              <input className="input mono" value={editingAc.id} onChange={e => setEditingAc({ ...editingAc, id: e.target.value })}/>
            </Fld>
            <Fld label="Model">
              <select className="select" value={editingAc.model} onChange={e => setEditingAc({ ...editingAc, model: e.target.value })}>
                <option>Skyhawk 6X</option>
                <option>Skyhawk 8X Pro</option>
                <option>Pelican-Q</option>
                <option>Pelican-Q Max</option>
                <option>Heron Mini</option>
                <option>Heron 2</option>
                <option>Phoenix-VTOL</option>
              </select>
            </Fld>
            <Fld label="Serial number" hint="From manufacturer">
              <input className="input mono" value={editingAc.serial || ""} onChange={e => setEditingAc({ ...editingAc, serial: e.target.value })} placeholder="e.g. SH6X-2026-1248"/>
            </Fld>
            <Fld label="Payload">
              <select className="select" value={editingAc.payload} onChange={e => setEditingAc({ ...editingAc, payload: e.target.value })}>
                <option>EO/IR</option>
                <option>EO/IR + LiDAR</option>
                <option>Multispectral</option>
                <option>Thermal</option>
                <option>Photogrammetry</option>
              </select>
            </Fld>
            <Fld label="Home location">
              <select className="select" value={editingAc.location} onChange={e => setEditingAc({ ...editingAc, location: e.target.value })}>
                {STATIONS.map(s => <option key={s.id}>{s.name}</option>)}
                <option>Service Bay 1</option>
                <option>Service Bay 2</option>
              </select>
            </Fld>
            <Fld label="Primary pilot">
              <select className="select" value={editingAc.assignedPilot || "—"} onChange={e => setEditingAc({ ...editingAc, assignedPilot: e.target.value })}>
                <option>—</option>
                {PILOTS.map(p => <option key={p.id}>{p.name}</option>)}
              </select>
            </Fld>
            <Fld label="Last service date">
              <input className="input" type="date" value={editingAc.lastService || ""} onChange={e => setEditingAc({ ...editingAc, lastService: e.target.value })}/>
            </Fld>
            <Fld label="Next service due">
              <input className="input" type="date" value={editingAc.nextService || ""} onChange={e => setEditingAc({ ...editingAc, nextService: e.target.value })}/>
            </Fld>
            <Fld label="Status">
              <select className="select" value={editingAc.status || "ready"} onChange={e => setEditingAc({ ...editingAc, status: e.target.value })}>
                <option value="ready">Ready</option>
                <option value="maintenance">Maintenance</option>
                <option value="grounded">Grounded</option>
              </select>
            </Fld>
            <Fld label="Acquisition date">
              <input className="input" type="date" defaultValue={new Date().toISOString().slice(0,10)}/>
            </Fld>
            <Fld label="Notes" full>
              <textarea className="input" rows="2" placeholder="Optional — purchase order, warranty, configuration notes…" defaultValue={editingAc.alert || ""}/>
            </Fld>
          </div>

          {/* Paired batteries hint */}
          <div style={{ marginTop: 18, padding: 14, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center" }}>
            <Icon name="battery" size={18} stroke="var(--text-2)"/>
            <div style={{ flex: 1, fontSize: 12.5, color: "var(--text-2)" }}>
              {batteryList.filter(b => b.aircraft === editingAc.id).length === 0
                ? "No batteries paired with this aircraft yet — register them on the Batteries tab."
                : `${batteryList.filter(b => b.aircraft === editingAc.id).length} battery${batteryList.filter(b => b.aircraft === editingAc.id).length === 1 ? "" : "ies"} paired with this aircraft.`}
            </div>
            <button className="btn btn-sm" onClick={() => { setEditingAc(null); setTab("batteries"); setTimeout(() => setEditingBat({ _new: true, id: nextBatId(batteryList, editingAc.id), aircraft: editingAc.id, capacity: 5900, maxCycles: 500, lastCharge: "—" }), 100); }}>
              <Icon name="plus" size={12}/> Add battery
            </button>
          </div>
        </Modal>
      )}

      {/* Edit / register battery */}
      {editingBat && (
        <Modal open onClose={() => setEditingBat(null)}
               title={editingBat._new ? "Register new battery" : `Edit ${editingBat.id}`}
               subtitle={editingBat._new ? "Add a battery to inventory" : "Update battery details"}
               icon="battery"
               footer={<>
                 <button className="btn" onClick={() => setEditingBat(null)}>Cancel</button>
                 <button className="btn btn-primary" onClick={() => saveBattery(editingBat)}>
                   <Icon name="check" size={14}/> {editingBat._new ? "Register battery" : "Save changes"}
                 </button>
               </>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Fld label="Battery ID">
              <input className="input mono" value={editingBat.id} onChange={e => setEditingBat({ ...editingBat, id: e.target.value })}/>
            </Fld>
            <Fld label="Paired aircraft">
              <select className="select" value={editingBat.aircraft || ""} onChange={e => setEditingBat({ ...editingBat, aircraft: e.target.value })}>
                <option value="">— Unassigned —</option>
                {aircraftList.map(a => <option key={a.id} value={a.id}>{a.id} ({a.model})</option>)}
              </select>
            </Fld>
            <Fld label="Capacity (mAh)">
              <input className="input mono" type="number" value={editingBat.capacity} onChange={e => setEditingBat({ ...editingBat, capacity: +e.target.value })}/>
            </Fld>
            <Fld label="Max cycle rating">
              <input className="input mono" type="number" value={editingBat.maxCycles} onChange={e => setEditingBat({ ...editingBat, maxCycles: +e.target.value })}/>
            </Fld>
            <Fld label="Status">
              <select className="select" value={editingBat.status || "ready"} onChange={e => setEditingBat({ ...editingBat, status: e.target.value })}>
                <option value="ready">Ready</option>
                <option value="warn">Watch</option>
                <option value="retire">Retire soon</option>
                <option value="grounded">Grounded</option>
              </select>
            </Fld>
            <Fld label="Acquisition date">
              <input className="input" type="date" defaultValue={new Date().toISOString().slice(0,10)}/>
            </Fld>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TabBtn({ k, cur, onClick, ic, l, c }) {
  return (
    <button onClick={() => onClick(k)} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "7px 12px", borderRadius: 6, border: "none",
      background: cur === k ? "var(--accent-soft)" : "transparent",
      color: cur === k ? "var(--accent)" : "var(--text-2)",
      fontSize: 12.5, fontWeight: 500, cursor: "pointer"
    }}>
      <Icon name={ic} size={12}/>{l}
      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: 4 }}>{c}</span>
    </button>
  );
}

function Fld({ label, hint, children, full }) {
  return (
    <div className="field" style={full ? { gridColumn: "span 2" } : {}}>
      <label className="field-label">{label}{hint && <span style={{ color: "var(--text-3)", fontWeight: 400, marginLeft: 6 }}>{hint}</span>}</label>
      {children}
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
      <Icon name="drone" size={28} stroke="var(--text-4)"/>
      <div style={{ marginTop: 10, fontSize: 13 }}>No aircraft in registry yet.</div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onAdd}><Icon name="plus" size={13}/> Register first aircraft</button>
    </div>
  );
}

function nextId(prefix, list) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const taken = new Set(list.map(a => a.id));
  for (const L of letters) {
    for (let n = 1; n <= 99; n++) {
      const id = `${prefix}-${L}${String(n).padStart(2, "0")}`;
      if (!taken.has(id)) return id;
    }
  }
  return prefix + "-NEW";
}

function nextBatId(list, ac) {
  const acPart = (ac || "UAV-XX").replace("UAV-", "");
  const sameAc = list.filter(b => b.aircraft === ac);
  const n = sameAc.length + 1;
  return `BAT-${acPart}-${String(n).padStart(2, "0")}`;
}

Object.assign(window, { AdminAircraftView });
