import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite } from '@/lib/publicApi';
import TrackRequest from '@/components/site/TrackRequest';

export const metadata: Metadata = { title: 'My requests', robots: { index: false } };

export default async function Track({ params, searchParams }: { params: { slug: string }; searchParams: { ref?: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  const ref = typeof searchParams.ref === 'string' && /^BA-[A-Z0-9]{8}$/i.test(searchParams.ref) ? searchParams.ref.toUpperCase() : undefined;
  return (
    <div className="s-wrap" style={{ paddingBottom: 56 }}>
      <div className="s-page-head" style={{ marginBottom: 18 }}>
        <h1>My requests</h1>
        <p>See replies from {site.company.name} and the status of your viewings. Enter your reference and the phone or email you used.</p>
      </div>
      <TrackRequest slug={site.company.slug} companyName={site.company.name} initialRef={ref} />
    </div>
  );
}
