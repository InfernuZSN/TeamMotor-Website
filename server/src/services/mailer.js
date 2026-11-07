/* ==========================================================================
   mailer.js — Zero-dependency SMTP over TLS client (Gmail / RFC 5321)
   --------------------------------------------------------------------------
   Sends transactional emails (e.g. 6-digit Forgot Password OTP codes) using
   Node's built-in `tls` module (or `nodemailer` if installed).
   ========================================================================== */
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('../utils/errors');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Low-level SMTP client over implicit TLS (port 465) or STARTTLS (port 587).
 */
function sendRawSmtp({ host, port, user, pass, from, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    let socket = null;
    let settled = false;
    let buffer = '';
    let currentWaiter = null;
    const responseLines = [];

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      if (socket && !socket.destroyed) {
        try { socket.destroy(); } catch (_) {}
      }
      if (err) reject(err);
      else resolve(val);
    };

    const timer = setTimeout(() => {
      finish(new Error('SMTP connection timed out after 20 seconds.'));
    }, 20000);

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        responseLines.push(line);
        // Final line of an SMTP reply has a space (or end of string) at index 3, not '-'
        if (line.length >= 3 && /^\d{3}(?: |$)/.test(line)) {
          const code = parseInt(line.slice(0, 3), 10);
          const fullText = responseLines.splice(0, responseLines.length).join('\n');
          if (currentWaiter) {
            const w = currentWaiter;
            currentWaiter = null;
            w({ code, text: fullText });
          }
        }
      }
    }

    function waitResponse(expectedCodes) {
      return new Promise((res, rej) => {
        currentWaiter = ({ code, text: replyText }) => {
          if (expectedCodes.includes(code)) {
            res({ code, text: replyText });
          } else {
            rej(new Error(`SMTP error (${code}): ${replyText}`));
          }
        };
      });
    }

    async function sendCmd(cmd, expectedCodes) {
      const p = waitResponse(expectedCodes);
      socket.write(cmd + '\r\n');
      return p;
    }

    function attachListeners(sock) {
      sock.on('data', onData);
      sock.on('error', (err) => {
        clearTimeout(timer);
        finish(err);
      });
      sock.on('close', () => {
        clearTimeout(timer);
        if (!settled) finish(new Error('SMTP connection closed unexpectedly.'));
      });
    }

    async function runSession() {
      try {
        await sendCmd('EHLO teammotor.local', [250]);

        if (port !== 465) {
          // Upgrade to TLS via STARTTLS
          await sendCmd('STARTTLS', [220]);
          socket.removeAllListeners('data');
          socket = await new Promise((res, rej) => {
            const tlsSock = tls.connect({ socket, servername: host }, () => res(tlsSock));
            tlsSock.once('error', rej);
          });
          attachListeners(socket);
          await sendCmd('EHLO teammotor.local', [250]);
        }

        // Authenticate via AUTH LOGIN
        await sendCmd('AUTH LOGIN', [334]);
        await sendCmd(Buffer.from(user, 'utf8').toString('base64'), [334]);
        await sendCmd(Buffer.from(pass, 'utf8').toString('base64'), [235]);

        await sendCmd(`MAIL FROM:<${user}>`, [250]);
        await sendCmd(`RCPT TO:<${to}>`, [250, 251]);
        await sendCmd('DATA', [354]);

        const boundary = '----=_TeamMotorPart_' + crypto.randomBytes(12).toString('hex');
        const msgId = `<${crypto.randomUUID()}@gmail.com>`;
        const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
        const fromHeader = from && from.includes('<') ? from : `TeamMotor <${user}>`;

        const mimeLines = [
          `From: ${fromHeader}`,
          `To: <${to}>`,
          `Subject: ${encodedSubject}`,
          `Date: ${new Date().toUTCString()}`,
          `Message-ID: ${msgId}`,
          'MIME-Version: 1.0',
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
          '',
          `--${boundary}`,
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
          '',
          `--${boundary}--`,
          ''
        ];

        // Dot-stuff lines beginning with '.' per RFC 5321
        const body = mimeLines
          .join('\r\n')
          .split(/\r?\n/)
          .map(l => (l.startsWith('.') ? '.' + l : l))
          .join('\r\n');

        await sendCmd(body + '\r\n.', [250]);
        try { await sendCmd('QUIT', [221]); } catch (_) {}

        clearTimeout(timer);
        finish(null, { ok: true, messageId: msgId });
      } catch (err) {
        clearTimeout(timer);
        finish(err);
      }
    }

    const greetingPromise = waitResponse([220]);
    if (port === 465) {
      socket = tls.connect({ host, port, servername: host });
    } else {
      socket = net.connect({ host, port });
    }
    attachListeners(socket);
    greetingPromise.then(() => runSession()).catch((err) => {
      clearTimeout(timer);
      finish(err);
    });
  });
}

/**
 * Send email via Resend HTTPS REST API (Port 443).
 * Render's Free tier blocks raw SMTP ports (25, 465, 587), so HTTPS APIs like Resend
 * are the standard way to send transactional emails without getting blocked by Render's firewall.
 */
async function sendViaResend({ apiKey, from, to, subject, text, html }) {
  const sender = from || 'TeamMotor <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: sender,
      to: [to],
      subject,
      text,
      html
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${data.message || res.statusText || 'Unknown error'}`);
  }
  return { ok: true, id: data.id };
}

/**
 * Send email via Brevo HTTPS REST API (Port 443).
 * Brevo allows sending transactional emails to ANY recipient email address on its free tier (300 emails/day),
 * using standard HTTPS port 443 which is never blocked by Render.
 */
async function sendViaBrevo({ apiKey, senderEmail, senderName, to, name, subject, text, html }) {
  const fromEmail = senderEmail || 'no-reply@teammotor.com';
  const fromName = senderName || 'TeamMotor';

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to, name: name || to }],
      subject,
      textContent: text,
      htmlContent: html
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || (data.errors && JSON.stringify(data.errors)) || res.statusText || 'Unknown error';
    throw new Error(`Brevo API error (${res.status}): ${msg}`);
  }
  return { ok: true, messageId: data.messageId };
}

/**
 * Sends a 6-digit password reset OTP email to the user.
 */
async function sendPasswordResetOtpEmail({ to, name, username, otp }) {
  const smtp = config.smtp || {};
  const resendApiKey = config.resendApiKey;
  const brevoApiKey = config.brevoApiKey;

  if (!brevoApiKey && !resendApiKey && (!smtp.user || !smtp.pass)) {
    throw new HttpError(500, 'Email service is not configured on the server (missing BREVO_API_KEY, RESEND_API_KEY, or SMTP credentials in environment variables).');
  }

  const displayName = name || username || 'User';
  const subject = `${otp} is your TeamMotor password reset code`;

  const text = [
    `Hello ${displayName},`,
    '',
    'We received a request to reset the password for your TeamMotor account.',
    '',
    `Your 6-digit verification code is: ${otp}`,
    '',
    'This code will expire in 10 minutes.',
    'If you did not request a password reset, you can safely ignore this email.',
    '',
    '— Estacio Garage / TeamMotor Parts & Accessories'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181d25;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);border:1px solid #e5e7eb;">
          <tr>
            <td style="background-color:#11141a;padding:24px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;letter-spacing:0.5px;">TeamMotor</h1>
              <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Estacio Garage &bull; Parts &amp; Accessories</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 12px;font-size:20px;color:#11141a;">Password Reset Verification</h2>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">
                Hello <strong>${escapeHtml(displayName)}</strong> (<code>${escapeHtml(username)}</code>),<br>
                Enter the 6-digit verification code below on the TeamMotor login page to verify your email and set a new password:
              </p>
              <div style="background-color:#f9fafb;border:2px dashed #d1d5db;border-radius:10px;padding:20px;text-align:center;margin:24px 0;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:6px;font-weight:600;">Verification Code</div>
                <div style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#d92626;">${escapeHtml(otp)}</div>
              </div>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#6b7280;">
                This code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#9ca3af;">
                If you did not request a password reset, you can safely ignore this email—your account remains secure.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
              &copy; ${new Date().getFullYear()} Estacio Garage TeamMotor POS &amp; Inventory System
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    if (brevoApiKey) {
      return await sendViaBrevo({
        apiKey: brevoApiKey,
        senderEmail: config.brevoSenderEmail,
        senderName: config.brevoSenderName,
        to,
        name: displayName,
        subject,
        text,
        html
      });
    }

    if (resendApiKey) {
      return await sendViaResend({
        apiKey: resendApiKey,
        from: smtp.from || 'TeamMotor <onboarding@resend.dev>',
        to,
        subject,
        text,
        html
      });
    }

    return await sendRawSmtp({
      host: smtp.host || 'smtp.gmail.com',
      port: Number(smtp.port) || 465,
      user: smtp.user,
      pass: smtp.pass,
      from: smtp.from || `TeamMotor <${smtp.user}>`,
      to,
      subject,
      text,
      html
    });
  } catch (err) {
    console.error('[mailer] Failed to send OTP email:', err.message);
    throw new HttpError(502, `Could not send verification email: ${err.message}. (Note: Render Free tier blocks outbound SMTP ports 465/587; set BREVO_API_KEY to send via HTTPS).`);
  }
}

module.exports = { sendPasswordResetOtpEmail, sendRawSmtp };
