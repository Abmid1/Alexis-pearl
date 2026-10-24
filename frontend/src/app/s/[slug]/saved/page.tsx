import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite } from '@/lib/publicApi';
import SavedList from '@/components/site/SavedList';

export const metadata: Metadata = { title: 'Saved homes', robots: { index: false } };

export default async function Saved({ params }: { params: { slug: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  return (
    <div className="s-wrap" style={{ paddingBottom: 56 }}>
      <div className="s-page-head" style={{ marginBottom: 18 }}>
        <h1>Saved homes</h1>
        <p>Your shortlist from {site.company.name}, saved on this device.</p>
      </div>
      <SavedList slug={site.company.slug} />
    </div>
  );
}
