import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite } from '@/lib/publicApi';
import AccountPortal from '@/components/site/AccountPortal';

export const metadata: Metadata = { title: 'My account', robots: { index: false } };

export default async function Account({ params }: { params: { slug: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  return (
    <div className="s-wrap" style={{ paddingBottom: 56 }}>
      <div className="s-page-head" style={{ marginBottom: 18 }}>
        <h1>My account</h1>
        <p>Your requests, viewings, applications and saved homes with {site.company.name}.</p>
      </div>
      <AccountPortal slug={site.company.slug} companyName={site.company.name} />
    </div>
  );
}
