// ============================================================
// FILE: backend/src/services/inventoryEmail.service.js
// Matches REAL schema: inventory_items + inventory_stock
// (locations: CHEMICAL_STORE, MAIN_LAB, DET_LAB)
// Reorder level checked against MAIN_LAB quantity
// Recipients: QC Head, QC Assistant, all Shift Supervisors
// ============================================================

'use strict';

const nodemailer = require('nodemailer');
const supabase    = require('../config/supabase');

// ── Mail transporter ──────────────────────────────────────
const transporter = nodemailer.createTransport({
  host  : process.env.SMTP_HOST,
  port  : parseInt(process.env.SMTP_PORT || '587'),
  secure: true,
  family: 4, // force IPv4 (avoid IPv6 issues)
  auth  : {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Get recipient emails ──────────────────────────────────
async function getRecipients() {
  const TARGET_ROLES = ['QC Head', 'QC Assistant', 'Shift Supervisor'];
  const { data } = await supabase
    .from('app_users')
    .select('full_name, email, roles(name)')
    .in('roles.name', TARGET_ROLES)
    .eq('is_active', true);

  return (data || [])
    .filter(u => u.email?.trim())
    .map(u => ({ name: u.full_name, email: u.email.trim() }));
}

// ── Get all items via the full status view ────────────────
async function getAllInventoryItems() {
  const { data, error } = await supabase
    .from('inventory_full_status')
    .select('*')
    .order('category_name', { ascending: true });
  if (error) console.error('[Inventory Email] getAllInventoryItems error:', error.message);
  return data || [];
}

// ── Get only items below reorder level (Main Lab) ─────────
async function getLowStockItems() {
  const { data, error } = await supabase
    .from('inventory_low_stock')
    .select('*')
    .order('category_name', { ascending: true });
  if (error) console.error('[Inventory Email] getLowStockItems error:', error.message);
  return data || [];
}

// ── Status badge HTML ─────────────────────────────────────
function statusBadge(mainQty, reorderLevel) {
  if (mainQty === 0) {
    return `<span style="background:#FEE2E2;color:#991B1B;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">⛔ OUT OF STOCK</span>`;
  }
  const pct = reorderLevel > 0 ? (mainQty / reorderLevel) * 100 : 100;
  if (pct <= 25) {
    return `<span style="background:#FEE2E2;color:#991B1B;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">🔴 CRITICAL LOW</span>`;
  }
  return `<span style="background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">🟡 LOW STOCK</span>`;
}

// ── Build beautiful HTML email ────────────────────────────
function buildEmailHTML({ triggerType, triggeredBy, lowItems, allItems, timestamp }) {
  const now = new Date(timestamp).toLocaleString('en-UG', {
    timeZone : 'Africa/Kampala',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const triggerLabels = {
    requisition: '📋 Lab Requisition Fulfilled',
    transfer   : '🔄 Lab-to-Lab Transfer Completed',
    usage      : '🧪 Lab Usage Recorded',
  };
  const triggerLabel = triggerLabels[triggerType] || '📦 Inventory Transaction';

  // ── Low stock table rows ──
  const lowRows = lowItems.map((item, i) => {
    const storeQty  = parseFloat(item.chemical_store_qty   || 0);
    const mainQty   = parseFloat(item.main_lab_qty          || 0);
    const inUse     = parseFloat(item.main_lab_in_use        || 0);
    const notInUse  = parseFloat(item.main_lab_not_in_use     || 0);
    const detQty    = parseFloat(item.det_lab_qty            || 0);
    const reorder   = parseFloat(item.reorder_level || 0);
    const rowBg     = i % 2 === 0 ? '#FFFFFF' : '#FFF5F5';
    const badge     = statusBadge(mainQty, reorder);

    return `
      <tr style="background:${rowBg};">
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;font-weight:700;color:#111827;font-size:13px;">
          ${item.item_name}
          <div style="font-size:11px;color:#6B7280;font-weight:400;margin-top:1px;">${item.category_name || '—'}</div>
        </td>
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;text-align:center;font-size:13px;color:#374151;">${storeQty} ${item.unit||''}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;text-align:center;">
          <span style="font-weight:800;font-size:14px;color:#DC2626;">${mainQty} ${item.unit||''}</span>
        </td>
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;text-align:center;font-size:13px;color:#7C3AED;font-weight:600;">${inUse} ${item.unit||''}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;text-align:center;font-size:13px;color:#059669;font-weight:600;">${notInUse} ${item.unit||''}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;text-align:center;font-size:13px;color:#374151;">${detQty} ${item.unit||''}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;text-align:center;font-size:13px;color:#D97706;font-weight:700;">${reorder} ${item.unit||''}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #FEE2E2;text-align:center;">${badge}</td>
      </tr>`;
  }).join('');

  // ── Full inventory summary rows ──
  const allRows = allItems.map((item, i) => {
    const storeQty = parseFloat(item.chemical_store_qty  || 0);
    const mainQty  = parseFloat(item.main_lab_qty          || 0);
    const inUse    = parseFloat(item.main_lab_in_use        || 0);
    const notInUse = parseFloat(item.main_lab_not_in_use     || 0);
    const detQty   = parseFloat(item.det_lab_qty            || 0);
    const reorder  = parseFloat(item.reorder_level || 0);
    const isLow    = item.is_low_stock;
    const rowBg    = isLow ? '#FFF5F5' : (i % 2 === 0 ? '#FFFFFF' : '#F9FAFB');

    return `
      <tr style="background:${rowBg};">
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;font-weight:${isLow?'700':'500'};color:${isLow?'#991B1B':'#111827'};font-size:12px;">
          ${item.item_name}
          <div style="font-size:10px;color:#9CA3AF;font-weight:400;">${item.category_name || '—'}</div>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;text-align:center;font-size:12px;color:#374151;">${storeQty} ${item.unit||''}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;text-align:center;font-weight:700;font-size:12px;color:${isLow?'#DC2626':'#059669'};">${mainQty} ${item.unit||''}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;text-align:center;font-size:12px;color:#7C3AED;">${inUse} ${item.unit||''}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;text-align:center;font-size:12px;color:#059669;">${notInUse} ${item.unit||''}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;text-align:center;font-size:12px;color:#374151;">${detQty} ${item.unit||''}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;text-align:center;font-size:12px;color:#D97706;font-weight:600;">${reorder} ${item.unit||''}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #F3F4F6;text-align:center;">
          ${isLow
            ? `<span style="background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">⚠️ LOW</span>`
            : `<span style="background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">✓ OK</span>`
          }
        </td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>BUL QC — Low Stock Alert</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;">
  <tr><td align="center">
  <table width="720" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <!-- ── Header ── -->
    <tr>
      <td style="background:linear-gradient(135deg,#6B21A8,#7C3AED);padding:28px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-size:11px;color:#DDD6FE;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">BIDCO UGANDA LIMITED</div>
              <div style="font-size:22px;font-weight:900;color:#FFFFFF;margin-bottom:2px;">⚠️ Low Stock Alert</div>
              <div style="font-size:13px;color:#C4B5FD;">Quality Control Laboratory — Inventory Management System</div>
            </td>
            <td align="right" style="vertical-align:top;">
              <div style="background:rgba(255,255,255,0.15);border-radius:10px;padding:10px 16px;text-align:center;">
                <div style="font-size:28px;font-weight:900;color:#FCD34D;">${lowItems.length}</div>
                <div style="font-size:11px;color:#DDD6FE;font-weight:600;">Item${lowItems.length !== 1 ? 's' : ''} Below Reorder</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── Trigger info bar ── -->
    <tr>
      <td style="background:#FEF3C7;padding:12px 32px;border-bottom:1px solid #FDE68A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#92400E;font-weight:700;">${triggerLabel}</td>
            <td align="right" style="font-size:12px;color:#B45309;">
              By: <strong>${triggeredBy}</strong> &nbsp;·&nbsp; ${now}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr><td style="padding:28px 32px;">

      <!-- ── Low stock items section ── -->
      <div style="font-size:16px;font-weight:800;color:#111827;margin-bottom:6px;">
        🔴 Items Requiring Immediate Attention
      </div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:16px;">
        The following items have fallen below the reorder level in the <strong>Main Lab</strong>.
        Please arrange replenishment urgently.
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #FEE2E2;">
        <thead>
          <tr style="background:linear-gradient(135deg,#DC2626,#B91C1C);">
            <th style="padding:11px 12px;text-align:left;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;white-space:nowrap;">ITEM NAME</th>
            <th style="padding:11px 12px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;white-space:nowrap;">CHEMICAL<br/>STORE</th>
            <th style="padding:11px 12px;text-align:center;font-size:10px;font-weight:700;color:#FCD34D;letter-spacing:0.5px;white-space:nowrap;">MAIN LAB ⚠️</th>
            <th style="padding:11px 12px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;white-space:nowrap;">IN USE<br/>(Main Lab)</th>
            <th style="padding:11px 12px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;white-space:nowrap;">NOT IN USE<br/>(Main Lab)</th>
            <th style="padding:11px 12px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;white-space:nowrap;">DET LAB</th>
            <th style="padding:11px 12px;text-align:center;font-size:10px;font-weight:700;color:#FCD34D;letter-spacing:0.5px;white-space:nowrap;">REORDER<br/>LEVEL</th>
            <th style="padding:11px 12px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;white-space:nowrap;">STATUS</th>
          </tr>
        </thead>
        <tbody>
          ${lowRows}
        </tbody>
      </table>

      <!-- ── Spacer ── -->
      <div style="height:28px;"></div>

      <!-- ── Full inventory summary ── -->
      <div style="font-size:16px;font-weight:800;color:#111827;margin-bottom:6px;">
        📊 Full Inventory Status — All Locations
      </div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:16px;">
        Current stock levels across Chemical Store, Main Lab and Detergent Lab. Red rows indicate items below reorder level in Main Lab.
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
        <thead>
          <tr style="background:linear-gradient(135deg,#6B21A8,#7C3AED);">
            <th style="padding:10px 10px;text-align:left;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">ITEM NAME</th>
            <th style="padding:10px 10px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">STORE</th>
            <th style="padding:10px 10px;text-align:center;font-size:10px;font-weight:700;color:#FCD34D;letter-spacing:0.5px;">MAIN LAB</th>
            <th style="padding:10px 10px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">IN USE</th>
            <th style="padding:10px 10px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">NOT IN USE</th>
            <th style="padding:10px 10px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">DET LAB</th>
            <th style="padding:10px 10px;text-align:center;font-size:10px;font-weight:700;color:#FCD34D;letter-spacing:0.5px;">REORDER</th>
            <th style="padding:10px 10px;text-align:center;font-size:10px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">STATUS</th>
          </tr>
        </thead>
        <tbody>
          ${allRows}
        </tbody>
      </table>

      <!-- ── Legend ── -->
      <div style="margin-top:16px;padding:12px 16px;background:#F9FAFB;border-radius:8px;border:1px solid #E5E7EB;">
        <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px;">LEGEND</div>
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:20px;font-size:11px;color:#374151;">
              <span style="background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-right:6px;">⚠️ LOW</span>Main Lab qty below reorder level
            </td>
            <td style="padding-right:20px;font-size:11px;color:#374151;">
              <span style="background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-right:6px;">✓ OK</span>Main Lab qty above reorder level
            </td>
          </tr>
          <tr><td colspan="2" style="height:6px;"></td></tr>
          <tr>
            <td colspan="2" style="font-size:11px;color:#6B7280;">
              <strong>Chemical Store</strong>, <strong>Main Lab</strong> &amp; <strong>Det Lab</strong> are the 3 stock locations.&nbsp;
              <strong>In Use</strong> / <strong>Not In Use</strong> apply to Main Lab — the location where reorder level is checked.
            </td>
          </tr>
        </table>
      </div>

    </td></tr>

    <!-- ── Footer ── -->
    <tr>
      <td style="background:#F9FAFB;padding:16px 32px;border-top:1px solid #E5E7EB;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;color:#6B7280;">
              This is an automated alert from <strong>BUL QC LIMS</strong>.<br/>
              Please do not reply to this email. Contact the QC team directly.
            </td>
            <td align="right" style="font-size:11px;color:#9CA3AF;">
              BUL QC LIMS v1.0.4<br/>
              Designed by Santos @ QC — 2026
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Main export: send low stock alert ─────────────────────
async function sendLowStockAlert({ triggerType, triggeredBy }) {
  try {
    const [lowItems, allItems, recipients] = await Promise.all([
      getLowStockItems(),
      getAllInventoryItems(),
      getRecipients(),
    ]);

    if (lowItems.length === 0) {
      console.log('[Inventory Email] No items below reorder level — alert skipped');
      return { sent: false, reason: 'No low stock items' };
    }
    if (recipients.length === 0) {
      console.warn('[Inventory Email] No recipients found — check emails on QC Head/Assistant/Supervisor accounts');
      return { sent: false, reason: 'No recipients' };
    }

    const timestamp = new Date().toISOString();
    const html      = buildEmailHTML({ triggerType, triggeredBy, lowItems, allItems, timestamp });
    const toList     = recipients.map(r => `"${r.name}" <${r.email}>`).join(', ');
    const subject    = `⚠️ BUL QC Lab — ${lowItems.length} Item${lowItems.length!==1?'s':''} Below Reorder Level (Main Lab)`;

    await transporter.sendMail({
      from: `"BUL QC LIMS" <${process.env.SMTP_USER}>`,
      to  : toList,
      subject,
      html,
    });

    console.log(`[Inventory Email] Sent to ${recipients.length} recipient(s) — ${lowItems.length} low stock item(s)`);
    return { sent: true, recipients: recipients.length, lowStockCount: lowItems.length };

  } catch(err) {
    console.error('[Inventory Email] Failed:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendLowStockAlert };
