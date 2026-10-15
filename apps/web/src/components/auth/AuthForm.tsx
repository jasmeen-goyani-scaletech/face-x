'use client';

import { Suspense, useEffect, useState, type FormEvent, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { describeError, fieldErrorsOf } from '@/lib/api/errors';
import type { ApiUser } from '@/lib/api/types';
import { isValidEmail } from '@/lib/validation';
import { useAuth } from './AuthProvider';
import { safeNextPath } from './RequireAuth';

const MIN_PASSWORD = 10; // the API's rule

type Mode = 'login' | 'signup';
type Field = 'fullName' | 'email' | 'password';

function Form({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const { status, user, restore, login, signup } = useAuth();
  // Coaches and staff land on their teams after signing in, unless they were sent here from a specific page.
  const landingFor = (u: ApiUser | null) =>
    mode === 'login' && !params.get('next') && u && !u.roles.includes('ADMIN') && u.roles.some((r) => r === 'COACH' || r === 'STAFF') ? '/admin/my-teams' : next;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set synchronously: a fast double-click would otherwise start twice before `submitting` shows up in the next render.
  const flight = useRef(false);

  // Someone who is already signed in (or whose cookie still works) has no reason to see this page.
  useEffect(() => {
    if (status === 'idle') void restore();
  }, [status, restore]);
  useEffect(() => {
    if (status === 'signedIn') router.replace(landingFor(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user, router, next]);

  function validate(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {};
    if (!isValidEmail(email)) e.email = 'Please enter a valid email address (e.g., name@example.com).';
    if (mode === 'signup' && password.length < MIN_PASSWORD) e.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (mode === 'login' && !password) e.password = 'Please enter your password.';
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      document.getElementById(Object.keys(found)[0])?.focus();
      return;
    }
    if (flight.current) return;
    flight.current = true;
    setSubmitting(true);
    try {
      const signedIn = mode === 'login' ? await login(email.trim(), password) : await signup({ email: email.trim(), password, fullName: fullName.trim() || undefined });
      router.replace(landingFor(signedIn));
    } catch (e) {
      const api = fieldErrorsOf(e);
      if (api.email || api.password || api.fullName) {
        setErrors({ email: api.email, password: api.password, fullName: api.fullName });
      } else {
        setFormError(describeError(e));
      }
      flight.current = false;
      setSubmitting(false);
    }
  }

  const other = mode === 'login' ? '/signup' : '/login';
  const otherHref = next === '/register' ? other : `${other}?next=${encodeURIComponent(next)}`;

  return (
    <main>
      <Topbar eyebrow={mode === 'login' ? 'Sign in' : 'Create account'} />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Card>
          <h1 className="text-xl mb-1">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
          <p className="text-ink-soft mb-5">
            {mode === 'login' ? 'Sign in to continue your registration.' : 'You’ll use this account to register, upload documents and track your status.'}
          </p>

          {formError && (
            <div className="mb-4">
              <Alert level="danger" title={mode === 'login' ? 'Couldn’t sign you in' : 'Couldn’t create your account'}>
                {formError}
              </Alert>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            {mode === 'signup' && (
              <TextField id="fullName" label="Full Name" optional autoComplete="name" value={fullName} error={errors.fullName} onChange={(e) => setFullName(e.target.value)} />
            )}
            <TextField
              id="email"
              label="Email"
              type="email"
              autoComplete={mode === 'login' ? 'username' : 'email'}
              placeholder="name@example.com"
              value={email}
              error={errors.email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              id="password"
              label="Password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              hint={mode === 'signup' ? `At least ${MIN_PASSWORD} characters.` : undefined}
              value={password}
              error={errors.password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" variant="primary" block className="mt-2" loading={submitting}>
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-5 mb-0 text-center text-sm text-ink-soft">
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <Link href={otherHref} className="font-bold text-primary-strong">
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}

export default function AuthForm({ mode }: { mode: Mode }) {
  return (
    <Suspense fallback={null}>
      <Form mode={mode} />
    </Suspense>
  );
}
