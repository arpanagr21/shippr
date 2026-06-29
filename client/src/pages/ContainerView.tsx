import { useParams, useLocation } from 'react-router-dom';
import Layout from '@/components/Layout';
import ContainerLogViewer from '@/components/ContainerLogViewer';

export default function ContainerView() {
  const { id } = useParams<{ id: string }>();
  const state  = useLocation().state as { name?: string } | null;
  const name   = state?.name ?? id ?? 'Container';

  if (!id) return null;

  return (
    <Layout
      fullHeight
      crumbs={[
        { label: 'Containers', href: '/containers' },
        { label: name },
      ]}
    >
      <div className="flex flex-col flex-1 min-h-0 p-4">
        <ContainerLogViewer containerId={id} />
      </div>
    </Layout>
  );
}
