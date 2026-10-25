import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite, API_BASE } from '@/lib/publicApi';
import ServiceRequestForm from '@/components/site/ServiceRequestForm';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const site = await getSite(params.slug).catch(() => null);
  return site ? { title: 'Owner & landlord services', description: `List a property, request a valuation or ask ${site.company.name} about property management.` } : { title: 'Services', robots: { index: false } };
}

export default async function Services({ params }: { params: { slug: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  const r = await fetch(`${API_BASE}/api/public/${encodeURIComponent(params.slug)}/services`, { next: { revalidate: 60 } });
  const services = r.ok ? (await r.json()).services : [];
  const c = site.company;
  const ownerOnly = services.filter((x: any) => x.key !== 'relocation');
  const heading = ownerOnly.length ? 'Owner & landlord services' : 'Relocation help';
  const blurb = ownerOnly.length ? `Work with ${c.name} on your own property.` : `${c.name} can help you find a home when you move.`;

  return (
    <div className="s-wrap" style={{ paddingBottom: 56 }}>
      <div className="s-page-head">
        <h1>{heading}</h1>
        <p>{services.length ? blurb : `${c.name} hasn't published these services here yet.`}</p>
      </div>
      {services.length ? (
        <ServiceRequestForm slug={c.slug} companyName={c.name} services={services} />
      ) : (
        <div className="s-empty">
          <h2>Nothing listed yet</h2>
          <p>Contact {c.name} directly and they'll tell you what they can help with.</p>
          <a className="s-btn s-btn-primary" href={`/s/${c.slug}#contact`}>Contact the agency</a>
        </div>
      )}
    </div>
  );
}
