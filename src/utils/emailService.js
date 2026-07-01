// ============================================================
// FILE: backend/src/utils/emailService.js
// Sends verification emails for password/username changes.
// Uses Resend (HTTPS API) instead of Gmail SMTP — Render's free
// tier blocks outbound SMTP ports, the same issue we already
// fixed for inventory low-stock alerts. Resend works reliably
// since it sends over HTTPS (port 443), not SMTP.
// ============================================================

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

if (process.env.RESEND_API_KEY) {
  console.log('✅ Email service configured (Resend)');
} else {
  console.log('⚠️  RESEND_API_KEY missing — email verification will use console logging instead.');
}

const sendVerificationCode = async (toEmail, code, changeType) => {
  const subject = `BUL QC App — ${
    changeType === 'password' ? 'Password Change' : 'Username Change'
  } Verification Code`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <div style="background: #7C3AED; padding: 20px; border-radius: 12px 12px 0 0;">
        <h2 style="color: #fff; margin: 0;">🧪 BUL QC App</h2>
        <p style="color: #DDD6FE; margin: 4px 0 0; font-size: 13px;">
          Laboratory Information Management System
        </p>
      </div>
      <div style="background: #fff; padding: 24px;
                  border: 1px solid #EDE9FE;
                  border-radius: 0 0 12px 12px;">
        <h3 style="color: #1F2937;">
          ${changeType === 'password' ? 'Password' : 'Username'} Change Request
        </h3>
        <p style="color: #6B7280; font-size: 14px;">
          A ${changeType} change was requested on your BUL QC account.
          Use the code below. This code expires in <strong>10 minutes</strong>.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <div style="font-size: 42px; font-weight: 900;
                      letter-spacing: 12px; color: #7C3AED;
                      background: #F5F3FF; padding: 20px;
                      border-radius: 14px;
                      border: 2px dashed #7C3AED;">
            ${code}
          </div>
        </div>
        <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
          If you did not request this, ignore this email.
          Do not share this code with anyone.
        </p>
      </div>
      <p style="text-align: center; font-size: 11px;
                color: #9CA3AF; margin-top: 12px;">
        Designed by SantosInfographics © ${new Date().getFullYear()}
      </p>
    </div>
  `;

  // If Resend isn't configured at all, log the code so development
  // and local testing can still proceed without a real send.
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n📧 EMAIL NOT SENT (no RESEND_API_KEY configured)`);
    console.log(`   To: ${toEmail}`);
    console.log(`   Code: ${code}`);
    console.log(`   Type: ${changeType}\n`);
    return true; // Return true so the flow continues during local dev
  }

  try {
    const { data, error } = await resend.emails.send({
      from   : 'BUL QC App <onboarding@resend.dev>',
      to     : [toEmail],
      subject,
      html,
    });

    if (error) throw new Error(error.message || JSON.stringify(error));

    console.log(`✅ Verification email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
    // Don't crash — return false so controller can handle it
    return false;
  }
};

module.exports = { sendVerificationCode };
