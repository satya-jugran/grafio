import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.heroButtons}>
          <Link
            className="button button--primary button--lg"
            to="docs/getting-started/installation">
            Get Started
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="docs/guides/core-concepts">
            Read the Guides
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.featureCard}>
      <Heading as="h3" className={styles.featureTitle}>
        {title}
      </Heading>
      <p>{description}</p>
    </div>
  );
}

function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className={styles.featuresGrid}>
        <FeatureCard
          title="Pluggable Storage"
          description="Swap storage backends without changing application code. In-memory built-in, MongoDB available separately."
        />
        <FeatureCard
          title="Cypher Queries"
          description="OpenCypher-compatible query language with aggregations, variable-length paths, and query plan inspection."
        />
        <FeatureCard
          title="Multi-Hop Traversal"
          description="BFS and DFS traversal with type and property filtering. Find paths between any nodes."
        />
        <FeatureCard
          title="Transaction Support"
          description="Atomic multi-operation updates with automatic rollback on failure."
        />
        <FeatureCard
          title="Smart Caching"
          description="LRU/LFU/FIFO caching with budget enforcement. In-memory or Redis backends."
        />
        <FeatureCard
          title="Graph Analysis"
          description="DAG validation, topological sorting, and Mermaid diagram export."
        />
      </div>
    </section>
  );
}

function CodeExamples() {
  const socialCode = `import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

const graph = new InMemoryGraphFactory().forGraph('social');
const cypher = new CypherEngine(graph);

graph.addNode({ id: 'alice', label: 'Person', properties: { name: 'Alice' } });
graph.addNode({ id: 'bob', label: 'Person', properties: { name: 'Bob' } });
graph.addNode({ id: 'charlie', label: 'Person', properties: { name: 'Charlie' } });
graph.addEdge({ from: 'alice', to: 'bob', label: 'KNOWS' });
graph.addEdge({ from: 'bob', to: 'charlie', label: 'KNOWS' });

const suggestions = cypher.execute(\`
  MATCH (p:Person)-[:KNOWS]->(f)-[:KNOWS]->(s)
  WHERE p.name = 'Alice' AND p <> s
  RETURN s.name as suggested
\`);
// Result: [{ suggested: 'Charlie' }]`;

  const ecommerceCode = `import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

const graph = new InMemoryGraphFactory().forGraph('shop');
const cypher = new CypherEngine(graph);

graph.addNode({ id: 'laptop', label: 'Product', properties: { name: 'Laptop', price: 999 } });
graph.addNode({ id: 'mouse', label: 'Product', properties: { name: 'Mouse', price: 29 } });
graph.addNode({ id: 'john', label: 'Customer', properties: { name: 'John' } });
graph.addNode({ id: 'order1', label: 'Order', properties: { total: 1028 } });

graph.addEdge({ from: 'john', to: 'order1', label: 'PLACED' });
graph.addEdge({ from: 'order1', to: 'laptop', label: 'CONTAINS' });
graph.addEdge({ from: 'order1', to: 'mouse', label: 'CONTAINS' });

const orders = cypher.execute(\`
  MATCH (c:Customer)-[:PLACED]->(o:Order)-[:CONTAINS]->(p:Product)
  RETURN c.name as customer, collect(p.name) as products
\`);
// Result: [{ customer: 'John', products: ['Laptop', 'Mouse'] }]`;

  const healthcareCode = `import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

const graph = new InMemoryGraphFactory().forGraph('clinic');
const cypher = new CypherEngine(graph);

graph.addNode({ id: 'john', label: 'Patient', properties: { name: 'John' } });
graph.addNode({ id: 'emily', label: 'Patient', properties: { name: 'Emily' } });
graph.addNode({ id: 'dr_chen', label: 'Doctor', properties: { name: 'Dr. Chen' } });
graph.addNode({ id: 'hbp', label: 'Condition', properties: { name: 'Hypertension' } });
graph.addNode({ id: 'migraine', label: 'Condition', properties: { name: 'Migraine' } });

graph.addEdge({ from: 'john', to: 'dr_chen', label: 'SEES' });
graph.addEdge({ from: 'john', to: 'hbp', label: 'DIAGNOSED_WITH' });
graph.addEdge({ from: 'emily', to: 'dr_chen', label: 'SEES' });
graph.addEdge({ from: 'emily', to: 'migraine', label: 'DIAGNOSED_WITH' });

const patients = cypher.execute(\`
  MATCH (doc)-[:SEES]-(p:Patient)-[:DIAGNOSED_WITH]-(c)
  RETURN doc.name as doctor, p.name as patient, c.name as condition
\`);
// Result: [{ doctor: 'Dr. Chen', patient: 'John', condition: 'Hypertension' }, ...]`;

  return (
    <section className={styles.codeSection}>
      <div className={styles.codeSectionInner}>
        <Heading as="h2" className={styles.codeSectionTitle}>
          See Grafio in Action
        </Heading>
        <p className={styles.codeSectionSubtitle}>
          Real-world use cases powered by Cypher queries
        </p>
        
        <Tabs groupId="use-case">
          <TabItem value="social" label="Social Network">
            <div className={styles.codeWindow}>
              <div className={styles.codeWindowHeader}>
                <div className={`${styles.windowButton} ${styles.windowButtonRed}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonYellow}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonGreen}`} />
              </div>
              <div className={styles.codeWindowBody}>
                <CodeBlock language="typescript">{socialCode}</CodeBlock>
              </div>
              <div className={styles.codeWindowFooter}>
                <span>TypeScript</span>
              </div>
            </div>
          </TabItem>
          <TabItem value="ecommerce" label="E-Commerce">
            <div className={styles.codeWindow}>
              <div className={styles.codeWindowHeader}>
                <div className={`${styles.windowButton} ${styles.windowButtonRed}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonYellow}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonGreen}`} />
              </div>
              <div className={styles.codeWindowBody}>
                <CodeBlock language="typescript">{ecommerceCode}</CodeBlock>
              </div>
              <div className={styles.codeWindowFooter}>
                <span>TypeScript</span>
              </div>
            </div>
          </TabItem>
          <TabItem value="healthcare" label="Healthcare">
            <div className={styles.codeWindow}>
              <div className={styles.codeWindowHeader}>
                <div className={`${styles.windowButton} ${styles.windowButtonRed}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonYellow}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonGreen}`} />
              </div>
              <div className={styles.codeWindowBody}>
                <CodeBlock language="typescript">{healthcareCode}</CodeBlock>
              </div>
              <div className={styles.codeWindowFooter}>
                <span>TypeScript</span>
              </div>
            </div>
          </TabItem>
        </Tabs>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Graph database with pluggable storage"
      description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <CodeExamples />
      </main>
    </Layout>
  );
}