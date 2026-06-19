// ============================================================
// FILE: backend/src/controllers/inventory.controller.js
// Matches REAL schema:
//   inventory_items, inventory_categories, inventory_stock,
//   inventory_requisitions + inventory_requisition_items,
//   inventory_transfers, inventory_breakages,
//   inventory_transactions
// Locations: CHEMICAL_STORE, MAIN_LAB, DET_LAB
// Reorder level checked against MAIN_LAB quantity
// Low stock email fires after: requisition, transfer, usage
// ============================================================

'use strict';

const supabase              = require('../config/supabase');
const { sendLowStockAlert } = require('../services/inventoryEmail.service');

// ── Fire-and-forget low stock email ───────────────────────
function triggerLowStockEmail(triggerType, triggeredBy) {
  sendLowStockAlert({ triggerType, triggeredBy })
    .then(result => {
      if (result.sent) console.log(`[Low Stock] Email sent after ${triggerType} by ${triggeredBy}`);
    })
    .catch(err => console.error('[Low Stock] Email error:', err.message));
}

// ── Helper: get one inventory_stock row (item+location) ───
async function getStockRow(itemId, location) {
  const { data } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('item_id', itemId)
    .eq('location', location)
    .maybeSingle();
  return data;
}

// ── Helper: upsert a stock row's quantity/in_stock/in_use ─
async function setStockRow(itemId, location, fields) {
  const { error } = await supabase
    .from('inventory_stock')
    .upsert({
      item_id : itemId,
      location,
      ...fields,
      last_updated: new Date().toISOString(),
    }, { onConflict: 'item_id,location' });
  if (error) throw new Error(error.message);
}

// ════════════════════════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════════════════════════
exports.getCategories = async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('inventory_categories')
      .select('id, name, code, icon, description')
      .order('name');
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ categories: data || [] });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ════════════════════════════════════════════════════════════
// ITEMS — reads from inventory_full_status view
// (pivots inventory_stock across all 3 locations)
// ════════════════════════════════════════════════════════════
exports.getItems = async function(req, res) {
  try {
    const { category_id } = req.query;

    let q = supabase.from('inventory_full_status').select('*').order('item_name');
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    let items = data || [];
    if (category_id) {
      // category_id filter requires join — fetch category name first
      const { data: cat } = await supabase
        .from('inventory_categories').select('name').eq('id', category_id).single();
      if (cat) items = items.filter(i => i.category_name === cat.name);
    }

    return res.json({ items });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ── ADD item (auto-creates 3 stock rows via DB trigger) ───
exports.addItem = async function(req, res) {
  try {
    const {
      category_id, item_name, unit_of_measurement,
      country_of_origin, reorder_level, expiry_date, comments,
      specifications, storage_conditions, restrictions, usage_description,
      brand_name, ph_range, capacity, type_or_brand,
      initial_chemical_store_qty, initial_main_lab_qty, initial_det_lab_qty,
    } = req.body;

    if (!item_name)   return res.status(400).json({ error: 'Item name is required' });
    if (!category_id) return res.status(400).json({ error: 'Category is required' });

    const { data: newItem, error } = await supabase
      .from('inventory_items')
      .insert({
        category_id,
        item_name          : item_name.trim(),
        unit_of_measurement: unit_of_measurement || null,
        country_of_origin  : country_of_origin   || null,
        reorder_level      : parseFloat(reorder_level || 0),
        expiry_date        : expiry_date || null,
        comments           : comments    || null,
        specifications     : specifications     || null,
        storage_conditions : storage_conditions || null,
        restrictions       : restrictions       || null,
        usage_description  : usage_description  || null,
        brand_name         : brand_name || null,
        ph_range           : ph_range   || null,
        capacity           : capacity   || null,
        type_or_brand      : type_or_brand || null,
        created_by         : req.user?.id,
        updated_by         : req.user?.id,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // DB trigger trig_init_stock auto-creates 3 stock rows at 0.
    // Apply any initial quantities supplied:
    const initQty = [
      ['CHEMICAL_STORE', initial_chemical_store_qty],
      ['MAIN_LAB',        initial_main_lab_qty],
      ['DET_LAB',         initial_det_lab_qty],
    ];
    for (const [loc, qty] of initQty) {
      const q = parseFloat(qty || 0);
      if (q > 0) {
        await setStockRow(newItem.id, loc, { quantity:q, in_stock:q, in_use:0 });
      }
    }

    return res.status(201).json({ message: 'Item added', item: newItem });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ── UPDATE item ───────────────────────────────────────────
exports.updateItem = async function(req, res) {
  try {
    const { id } = req.params;
    const updates = {};
    [
      'item_name','unit_of_measurement','country_of_origin','reorder_level',
      'expiry_date','comments','specifications','storage_conditions',
      'restrictions','usage_description','brand_name','ph_range',
      'capacity','type_or_brand','category_id',
    ].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updated_by = req.user?.id;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('inventory_items').update(updates).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ message: 'Item updated', item: data });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ════════════════════════════════════════════════════════════
// REQUISITIONS — Chemical Store → requesting lab
// Auto-fulfilled in one step; moves stock + triggers email
// ════════════════════════════════════════════════════════════
exports.createRequisition = async function(req, res) {
  try {
    const { requesting_lab, items, notes } = req.body;
    // items: [{ item_id, quantity_requested }]

    if (!requesting_lab || !['MAIN_LAB','DET_LAB'].includes(requesting_lab)) {
      return res.status(400).json({ error: 'requesting_lab must be MAIN_LAB or DET_LAB' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Validate stock availability for every item first
    for (const it of items) {
      const store = await getStockRow(it.item_id, 'CHEMICAL_STORE');
      const avail = parseFloat(store?.quantity || 0);
      if (avail < parseFloat(it.quantity_requested)) {
        const { data: itemInfo } = await supabase.from('inventory_items').select('item_name').eq('id', it.item_id).single();
        return res.status(400).json({ error: `Insufficient stock for "${itemInfo?.item_name||it.item_id}" in Chemical Store. Available: ${avail}` });
      }
    }

    // Create the requisition (auto-fulfilled)
    const { data: requisition, error: reqErr } = await supabase
      .from('inventory_requisitions')
      .insert({
        requesting_lab,
        requested_by      : req.user?.id,
        requested_by_name : req.user?.full_name,
        status             : 'fulfilled',
        approved_by        : req.user?.id,
        fulfilled_at       : new Date().toISOString(),
        notes              : notes || null,
      })
      .select()
      .single();

    if (reqErr) return res.status(400).json({ error: reqErr.message });

    // Process each item: move stock + log requisition_items + transaction
    for (const it of items) {
      const qty = parseFloat(it.quantity_requested);

      const { data: itemInfo } = await supabase
        .from('inventory_items').select('item_name, unit_of_measurement').eq('id', it.item_id).single();

      const store   = await getStockRow(it.item_id, 'CHEMICAL_STORE');
      const destLab = await getStockRow(it.item_id, requesting_lab);

      const newStoreQty = Math.max(parseFloat(store?.quantity||0) - qty, 0);
      const newDestQty  = parseFloat(destLab?.quantity||0) + qty;

      await setStockRow(it.item_id, 'CHEMICAL_STORE', {
        quantity: newStoreQty, in_stock: newStoreQty, in_use: store?.in_use||0,
      });
      await setStockRow(it.item_id, requesting_lab, {
        quantity: newDestQty, in_stock: (parseFloat(destLab?.in_stock||0)+qty), in_use: destLab?.in_use||0,
      });

      await supabase.from('inventory_requisition_items').insert({
        requisition_id     : requisition.id,
        item_id             : it.item_id,
        item_name           : itemInfo?.item_name,
        quantity_requested  : qty,
        quantity_issued      : qty,
        unit                 : itemInfo?.unit_of_measurement,
      });

      await supabase.from('inventory_transactions').insert({
        item_id          : it.item_id,
        item_name         : itemInfo?.item_name,
        transaction_type  : 'REQUISITION',
        from_location      : 'CHEMICAL_STORE',
        to_location        : requesting_lab,
        quantity           : qty,
        unit                : itemInfo?.unit_of_measurement,
        balance_after       : newDestQty,
        performed_by        : req.user?.id,
        performed_by_name   : req.user?.full_name,
        reference_no         : requisition.requisition_no,
        notes                : notes || null,
      });
    }

    // ── Trigger low stock email ────────────────────────────
    triggerLowStockEmail('requisition', req.user?.full_name || 'System');

    return res.status(201).json({
      message     : `Requisition ${requisition.requisition_no} fulfilled — ${items.length} item(s) moved to ${requesting_lab}`,
      requisition,
    });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ════════════════════════════════════════════════════════════
// LAB-TO-LAB TRANSFER (MAIN_LAB ↔ DET_LAB)
// ════════════════════════════════════════════════════════════
exports.createTransfer = async function(req, res) {
  try {
    const { item_id, quantity, from_lab, to_lab, notes } = req.body;

    if (!item_id)  return res.status(400).json({ error: 'Item is required' });
    if (!quantity) return res.status(400).json({ error: 'Quantity is required' });
    if (!['MAIN_LAB','DET_LAB'].includes(from_lab) || !['MAIN_LAB','DET_LAB'].includes(to_lab)) {
      return res.status(400).json({ error: 'from_lab and to_lab must be MAIN_LAB or DET_LAB' });
    }
    if (from_lab === to_lab) return res.status(400).json({ error: 'from_lab and to_lab cannot be the same' });

    const qty = parseFloat(quantity);
    if (qty <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0' });

    const { data: itemInfo } = await supabase
      .from('inventory_items').select('item_name, unit_of_measurement').eq('id', item_id).single();
    if (!itemInfo) return res.status(404).json({ error: 'Item not found' });

    const source = await getStockRow(item_id, from_lab);
    const sourceQty = parseFloat(source?.quantity || 0);
    if (sourceQty < qty) {
      return res.status(400).json({ error: `Insufficient stock in ${from_lab}. Available: ${sourceQty}` });
    }

    const dest = await getStockRow(item_id, to_lab);
    const newSourceQty = Math.max(sourceQty - qty, 0);
    const newDestQty   = parseFloat(dest?.quantity || 0) + qty;

    await setStockRow(item_id, from_lab, {
      quantity:newSourceQty, in_stock:Math.max(parseFloat(source?.in_stock||0)-qty,0), in_use:source?.in_use||0,
    });
    await setStockRow(item_id, to_lab, {
      quantity:newDestQty, in_stock:parseFloat(dest?.in_stock||0)+qty, in_use:dest?.in_use||0,
    });

    const { data: transfer, error: trErr } = await supabase
      .from('inventory_transfers')
      .insert({
        item_id, item_name:itemInfo.item_name,
        from_lab, to_lab, quantity:qty, unit:itemInfo.unit_of_measurement,
        requested_by:req.user?.id, requested_by_name:req.user?.full_name,
        approved_by:req.user?.id, status:'completed',
        notes:notes||null, completed_at:new Date().toISOString(),
      })
      .select().single();
    if (trErr) return res.status(400).json({ error: trErr.message });

    await supabase.from('inventory_transactions').insert({
      item_id, item_name:itemInfo.item_name,
      transaction_type:'TRANSFER',
      from_location:from_lab, to_location:to_lab,
      quantity:qty, unit:itemInfo.unit_of_measurement,
      balance_after:newDestQty,
      performed_by:req.user?.id, performed_by_name:req.user?.full_name,
      reference_no:transfer.transfer_no, notes:notes||null,
    });

    // ── Trigger low stock email ────────────────────────────
    triggerLowStockEmail('transfer', req.user?.full_name || 'System');

    return res.status(201).json({
      message: `${qty} ${itemInfo.unit_of_measurement||''} of ${itemInfo.item_name} transferred from ${from_lab} to ${to_lab}`,
      transfer,
    });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ════════════════════════════════════════════════════════════
// USAGE — consume (permanently used) or check_out/return
// (move between in_stock and in_use within same location)
// ════════════════════════════════════════════════════════════
exports.recordUsage = async function(req, res) {
  try {
    const { item_id, location, action, quantity, purpose, used_by } = req.body;
    // action: 'consume' | 'check_out' | 'return'

    if (!item_id)  return res.status(400).json({ error: 'Item is required' });
    if (!['MAIN_LAB','DET_LAB'].includes(location)) {
      return res.status(400).json({ error: 'location must be MAIN_LAB or DET_LAB' });
    }
    if (!['consume','check_out','return'].includes(action)) {
      return res.status(400).json({ error: 'action must be consume, check_out or return' });
    }

    const qty = parseFloat(quantity);
    if (qty <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0' });

    const { data: itemInfo } = await supabase
      .from('inventory_items').select('item_name, unit_of_measurement').eq('id', item_id).single();
    if (!itemInfo) return res.status(404).json({ error: 'Item not found' });

    const stock = await getStockRow(item_id, location);
    const curQty    = parseFloat(stock?.quantity || 0);
    const curStock  = parseFloat(stock?.in_stock || 0);
    const curInUse  = parseFloat(stock?.in_use   || 0);

    let newQty = curQty, newStock = curStock, newInUse = curInUse;
    let txnType = 'STOCK_OUT';
    let notes   = `${purpose || 'Lab usage'} — By: ${used_by || req.user?.full_name}`;

    if (action === 'consume') {
      if (curStock < qty) return res.status(400).json({ error: `Insufficient stock in ${location}. In stock: ${curStock}` });
      newQty   = Math.max(curQty - qty, 0);
      newStock = Math.max(curStock - qty, 0);
      txnType  = 'STOCK_OUT';
    } else if (action === 'check_out') {
      if (curStock < qty) return res.status(400).json({ error: `Insufficient available stock in ${location}. In stock: ${curStock}` });
      newStock = Math.max(curStock - qty, 0);
      newInUse = curInUse + qty;
      txnType  = 'STOCK_OUT';
    } else if (action === 'return') {
      if (curInUse < qty) return res.status(400).json({ error: `Cannot return more than is in use. In use: ${curInUse}` });
      newStock = curStock + qty;
      newInUse = Math.max(curInUse - qty, 0);
      txnType  = 'ADJUSTMENT';
      notes    = `Returned to stock — By: ${used_by || req.user?.full_name}`;
    }

    await setStockRow(item_id, location, { quantity:newQty, in_stock:newStock, in_use:newInUse });

    await supabase.from('inventory_transactions').insert({
      item_id, item_name:itemInfo.item_name,
      transaction_type: txnType,
      from_location: location, to_location: action==='return'?null:location,
      quantity: qty, unit: itemInfo.unit_of_measurement,
      balance_after: newQty,
      performed_by: req.user?.id, performed_by_name: req.user?.full_name,
      notes,
    });

    // ── Trigger low stock email ────────────────────────────
    triggerLowStockEmail('usage', used_by || req.user?.full_name || 'System');

    return res.status(201).json({
      message  : `Usage recorded for ${itemInfo.item_name} (${action})`,
      location, new_quantity: newQty, new_in_stock: newStock, new_in_use: newInUse,
    });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ── GET transactions log ──────────────────────────────────
exports.getTransactions = async function(req, res) {
  try {
    const { item_id, type, limit = 100 } = req.query;
    let q = supabase
      .from('inventory_transactions')
      .select('*')
      .order('transaction_date', { ascending: false })
      .limit(parseInt(limit));
    if (item_id) q = q.eq('item_id', item_id);
    if (type)    q = q.eq('transaction_type', type);
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ transactions: data || [] });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ── GET requisitions ───────────────────────────────────────
exports.getRequisitions = async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('inventory_requisitions')
      .select(`*, inventory_requisition_items(*)`)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ requisitions: data || [] });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ── GET transfers ──────────────────────────────────────────
exports.getTransfers = async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('inventory_transfers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ transfers: data || [] });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ── GET low stock items (Main Lab) ─────────────────────────
exports.getLowStockItems = async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('inventory_low_stock')
      .select('*')
      .order('item_name');
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ lowItems: data || [], count: (data||[]).length });
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

// ── Routes reference ───────────────────────────────────────
// GET    /api/inventory/categories        → getCategories
// GET    /api/inventory/items              → getItems
// POST   /api/inventory/items              → addItem
// PUT    /api/inventory/items/:id          → updateItem
// GET    /api/inventory/transactions       → getTransactions
// GET    /api/inventory/requisitions       → getRequisitions
// POST   /api/inventory/requisitions       → createRequisition ← triggers email
// GET    /api/inventory/transfers          → getTransfers
// POST   /api/inventory/transfers          → createTransfer    ← triggers email
// POST   /api/inventory/usage              → recordUsage       ← triggers email
// GET    /api/inventory/low-stock          → getLowStockItems
