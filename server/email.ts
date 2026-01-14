import { Resend } from 'resend';
import { log } from './index';
import type { Merchant } from '@shared/schema';

let connectionSettings: any;

// Token replacer with strict whitelist for security
function replaceTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{(customer_name|amount|update_url)\}\}/g, (match, key) => {
    return tokens[key] || match;
  });
}

async function getCredentials(): Promise<{ apiKey: string; fromEmail: string } | null> {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY 
      ? 'repl ' + process.env.REPL_IDENTITY 
      : process.env.WEB_REPL_RENEWAL 
      ? 'depl ' + process.env.WEB_REPL_RENEWAL 
      : null;

    if (!xReplitToken || !hostname) {
      return null;
    }

    connectionSettings = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
      {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        }
      }
    ).then(res => res.json()).then(data => data.items?.[0]);

    if (!connectionSettings || !connectionSettings.settings?.api_key) {
      return null;
    }
    
    return {
      apiKey: connectionSettings.settings.api_key,
      fromEmail: connectionSettings.settings.from_email || 'noreply@example.com'
    };
  } catch (error) {
    return null;
  }
}

async function getResendClient(): Promise<{ client: Resend; fromEmail: string } | null> {
  const credentials = await getCredentials();
  if (!credentials) {
    return null;
  }
  return {
    client: new Resend(credentials.apiKey),
    fromEmail: credentials.fromEmail
  };
}

export interface DunningEmailData {
  invoiceId: string;
  amountDue: number;
  currency: string;
  hostedInvoiceUrl?: string | null;
  attemptCount?: number;
  merchantId: string;
  merchant?: Merchant;
  customTemplate?: { subject: string; body: string };
}

export interface WeeklyDigestData {
  totalRecoveredCents: number;
  totalEmailsSent: number;
  merchantId: string;
}

export async function sendDunningEmail(
  to: string,
  data: DunningEmailData
): Promise<boolean> {
  const formattedAmount = (data.amountDue / 100).toFixed(2);
  const currencySymbol = data.currency.toUpperCase() === 'USD' ? '$' : data.currency.toUpperCase();
  const updateUrl = data.hostedInvoiceUrl || '';
  
  // Branding from merchant (with fallbacks)
  const brandColor = data.merchant?.brandColor || '#0066cc';
  const logoUrl = data.merchant?.logoUrl;
  const fromName = data.merchant?.fromName || data.merchant?.email || 'Support';
  
  // Token values for replacement
  const tokens = {
    customer_name: 'Customer',
    amount: `${currencySymbol}${formattedAmount}`,
    update_url: updateUrl,
  };
  
  // Select content (custom template or defaults)
  const defaultSubject = `Action Required: Payment of ${currencySymbol}${formattedAmount} Failed`;
  const defaultBody = `<p>We were unable to process your payment of <strong>{{amount}}</strong>.</p>
    <p>This is attempt ${data.attemptCount || 1} to collect this payment. Please update your payment method to avoid service interruption.</p>`;
  
  let subject = data.customTemplate?.subject || defaultSubject;
  let bodyContent = data.customTemplate?.body || defaultBody;
  
  // Apply token replacement
  subject = replaceTokens(subject, tokens);
  bodyContent = replaceTokens(bodyContent, tokens);
  
  // Assemble branded HTML shell
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment Failed</title>
</head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-top: 4px solid ${brandColor}; padding-top: 20px;">
    ${logoUrl ? `<img src="${logoUrl}" alt="Logo" style="max-height: 50px; margin-bottom: 20px;">` : ''}
    <h2 style="color: #333;">${subject}</h2>
    <div style="line-height: 1.6; color: #444;">${bodyContent}</div>
    ${updateUrl ? `
    <div style="margin: 30px 0;">
      <a href="${updateUrl}" 
         style="background-color: ${brandColor}; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Update Payment Method
      </a>
    </div>
    ` : ''}
    <p style="color: #666; font-size: 14px;">Invoice ID: ${data.invoiceId}</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="font-size: 12px; color: #999;">Sent by ${fromName} via Project Genesis</p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
${subject}

We were unable to process your payment of ${currencySymbol}${formattedAmount}.

This is attempt ${data.attemptCount || 1} to collect this payment. Please update your payment method to avoid service interruption.

${updateUrl ? `Update your payment method here: ${updateUrl}` : ''}

Invoice ID: ${data.invoiceId}

Sent by ${fromName}
  `.trim();

  const resend = await getResendClient();
  
  if (!resend) {
    log(`[DEV MODE] Email would be sent to: ${to}`, 'email');
    log(`[DEV MODE] Subject: ${subject}`, 'email');
    log(`[DEV MODE] Body: ${textBody.substring(0, 200)}...`, 'email');
    log(`[DEV MODE] Merchant: ${data.merchantId}, Invoice: ${data.invoiceId}`, 'email');
    return true;
  }

  try {
    const result = await resend.client.emails.send({
      from: resend.fromEmail,
      to: [to],
      subject,
      html: htmlBody,
      text: textBody,
      headers: {
        'X-Entity-Ref-ID': data.merchantId,
      },
    });

    if (result.error) {
      log(`Failed to send dunning email: ${result.error.message}`, 'email');
      return false;
    }

    log(`Dunning email sent to ${to} (ID: ${result.data?.id})`, 'email');
    return true;
  } catch (error: any) {
    log(`Email error: ${error.message}`, 'email');
    return false;
  }
}

export async function sendActionRequiredEmail(
  to: string,
  data: DunningEmailData
): Promise<boolean> {
  const formattedAmount = (data.amountDue / 100).toFixed(2);
  const currencySymbol = data.currency.toUpperCase() === 'USD' ? '$' : data.currency.toUpperCase();
  
  const subject = `Action Required: Verify Your Payment of ${currencySymbol}${formattedAmount}`;
  
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment Action Required</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #333;">Payment Verification Required</h1>
  
  <p>Your payment of <strong>${currencySymbol}${formattedAmount}</strong> requires additional verification.</p>
  
  <p>Your bank has requested additional authentication. Please complete the verification to process your payment.</p>
  
  ${data.hostedInvoiceUrl ? `
  <p style="margin: 30px 0;">
    <a href="${data.hostedInvoiceUrl}" 
       style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
      Complete Verification
    </a>
  </p>
  ` : ''}
  
  <p style="color: #666; font-size: 14px;">
    Invoice ID: ${data.invoiceId}
  </p>
  
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  
  <p style="color: #999; font-size: 12px;">
    If you have any questions, please contact our support team.
  </p>
</body>
</html>
  `.trim();

  const textBody = `
Payment Verification Required

Your payment of ${currencySymbol}${formattedAmount} requires additional verification.

Your bank has requested additional authentication. Please complete the verification to process your payment.

${data.hostedInvoiceUrl ? `Complete verification here: ${data.hostedInvoiceUrl}` : ''}

Invoice ID: ${data.invoiceId}

If you have any questions, please contact our support team.
  `.trim();

  const resend = await getResendClient();
  
  if (!resend) {
    log(`[DEV MODE] Action required email would be sent to: ${to}`, 'email');
    log(`[DEV MODE] Subject: ${subject}`, 'email');
    log(`[DEV MODE] Body: ${textBody.substring(0, 200)}...`, 'email');
    return true;
  }

  try {
    const result = await resend.client.emails.send({
      from: resend.fromEmail,
      to: [to],
      subject,
      html: htmlBody,
      text: textBody,
      headers: {
        'X-Entity-Ref-ID': data.merchantId,
      },
    });

    if (result.error) {
      log(`Failed to send action required email: ${result.error.message}`, 'email');
      return false;
    }

    log(`Action required email sent to ${to} (ID: ${result.data?.id})`, 'email');
    return true;
  } catch (error: any) {
    log(`Email error: ${error.message}`, 'email');
    return false;
  }
}

export async function sendWeeklyDigest(
  to: string,
  data: WeeklyDigestData
): Promise<boolean> {
  const recoveredDollars = (data.totalRecoveredCents / 100).toFixed(2);
  
  const subject = `Weekly Report: $${recoveredDollars} Recovered`;
  
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Weekly Report</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #333;">Weekly Report</h1>
  
  <p>We recovered <strong>$${recoveredDollars}</strong> for you this week.</p>
  
  <p>${data.totalEmailsSent} emails were sent to retain your customers.</p>
  
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  
  <p style="color: #999; font-size: 12px;">
    This is your weekly payment recovery summary.
  </p>
</body>
</html>
  `.trim();

  const textBody = `
Weekly Report

We recovered $${recoveredDollars} for you this week.

${data.totalEmailsSent} emails were sent to retain your customers.

This is your weekly payment recovery summary.
  `.trim();

  const resend = await getResendClient();
  
  if (!resend) {
    log(`[DEV MODE] Weekly digest would be sent to: ${to}`, 'email');
    log(`[DEV MODE] Subject: ${subject}`, 'email');
    log(`[DEV MODE] Recovered: $${recoveredDollars}, Emails: ${data.totalEmailsSent}`, 'email');
    return true;
  }

  try {
    const result = await resend.client.emails.send({
      from: resend.fromEmail,
      to: [to],
      subject,
      html: htmlBody,
      text: textBody,
      headers: {
        'X-Entity-Ref-ID': data.merchantId,
      },
    });

    if (result.error) {
      log(`Failed to send weekly digest: ${result.error.message}`, 'email');
      return false;
    }

    log(`Weekly digest sent to ${to} (ID: ${result.data?.id})`, 'email');
    return true;
  } catch (error: any) {
    log(`Email error: ${error.message}`, 'email');
    return false;
  }
}
