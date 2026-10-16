'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { CopyIcon } from '@/components/ui/Icons';
import { createSignInLink } from '@/lib/api/admin';
import { describeError } from '@/lib/api/errors';

/**
 * For a coach or staff member who registered without a password and has lost their session (new browser or phone, cleared
 * cookies). The admin creates a one-time link and sends it to them; opening it signs them in. The link is shown once, works
 * once, and expires after 24 hours. Creating a new one cancels the previous one.
 */
export default function SignInLinkCard({ registrationId, label }: { registrationId: string; label: string }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (pending) return;
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const { token, expiresAt } = await createSignInLink(registrationId);
      // The token goes in the fragment: it is never sent to a server, written to access logs or passed on in a Referer header.
      setLink({ url: `${window.location.origin}/signin#token=${token}`, expiresAt });
    } catch (e) {
      setError(describeError(e, 'We couldn’t create the sign-in link. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable: the link is still visible to copy by hand
    }
  }

  return (
    <Card className="mt-5">
      <h2 className="text-lg mb-1">Sign-in link</h2>
      <p className="text-ink-soft text-sm mb-4">
        This {label.toLowerCase()} has no password. If they can’t get back into their account, create a one-time link and send it to them. It works once and
        expires after 24 hours.
      </p>
      {error && (
        <div className="mb-3">
          <Alert level="danger" title="Something went wrong">
            {error}
          </Alert>
        </div>
      )}
      {link && (
        <div className="mb-4 rounded-s border border-line px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <input
              readOnly
              aria-label="Sign-in link"
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate bg-transparent text-[12.5px] text-ink outline-none"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="shrink-0 flex items-center gap-1.5 rounded-s border border-line-strong px-3 py-1.5 text-[12.5px] font-bold text-ink-soft hover:text-ink"
            >
              <CopyIcon size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="m-0 mt-1.5 text-[12px] text-ink-faint">
            Shown only now — copy it before leaving this page. Expires {new Date(link.expiresAt).toLocaleString()}.
          </p>
        </div>
      )}
      <Button variant="secondary" onClick={() => void create()} loading={pending}>
        {link ? 'Create a new link' : 'Create sign-in link'}
      </Button>
    </Card>
  );
}
