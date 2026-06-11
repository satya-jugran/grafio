import React, { useState, useEffect, useRef } from 'react';
import Layout from '@theme/Layout';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { datasets, Dataset } from '../components/datasets';
import styles from './playground.module.css';

// Type declarations to satisfy TS until module is fully typed via build
import { Graph, CypherEngine, PlanFormatter } from '@grafio/browser';

function VisualizerComponent({ 
  mode, 
  lastQueryResult, 
  isBrowser,
  showPermanentLabels,
  showEdgeLabels,
  onNodeClick,
  onLinkClick 
}: { 
  mode: '2d' | '3d', 
  lastQueryResult: any, 
  isBrowser: boolean,
  showPermanentLabels: boolean,
  showEdgeLabels: boolean,
  onNodeClick: (node: any) => void,
  onLinkClick: (link: any) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<any>(null);

  useEffect(() => {
    let isMounted = true;
    if (isBrowser && containerRef.current) {
      import('@grafio/visualizer').then(({ CypherVisualizer }) => {
        if (!isMounted) return;
        visualizerRef.current = new CypherVisualizer(containerRef.current!, { 
          mode, 
          showArrows: true,
          showPermanentLabels,
          showEdgeLabels,
          onNodeClick,
          onLinkClick
        });
        if (lastQueryResult) {
          visualizerRef.current.render(lastQueryResult);
        }
      });
      
      return () => {
        isMounted = false;
        if (visualizerRef.current) {
          visualizerRef.current.destroy();
          visualizerRef.current = null;
        }
      };
    }
  }, [isBrowser, mode, showPermanentLabels, showEdgeLabels]);

  useEffect(() => {
    if (visualizerRef.current && lastQueryResult) {
      visualizerRef.current.render(lastQueryResult);
    }
  }, [lastQueryResult]);

  return <div ref={containerRef} style={{ flex: 1, width: '100%', height: '100%', overflow: 'hidden', backgroundColor: 'var(--ifm-color-emphasis-100)' }} />;
}

export default function Playground() {
  const isBrowser = useIsBrowser();
  
  // State for Graph instances
  const [graph, setGraph] = useState<any>(null);
  const [engine, setEngine] = useState<any>(null);
  
  // State for UI
  const [activeDataset, setActiveDataset] = useState<Dataset>(datasets[0]);
  const [dataInput, setDataInput] = useState<string>(JSON.stringify(datasets[0].data, null, 2));
  const [queryInput, setQueryInput] = useState<string>("MATCH (n)-[r]->(m) return  n, r, m LIMIT 100");
  const [queryOutput, setQueryOutput] = useState<string>("Run a query to see results.");
  const [executionPlan, setExecutionPlan] = useState<string>("Execution plan will appear here.");
  
  const [visualizerMode, setVisualizerMode] = useState<'2d' | '3d'>('2d');
  const [lastQueryResult, setLastQueryResult] = useState<any>(null);
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [showPermanentLabels, setShowPermanentLabels] = useState<boolean>(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState<boolean>(true);
  const [initStatus, setInitStatus] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  // Initialize the graph on client side with default dataset
  useEffect(() => {
    let isMounted = true;
    if (isBrowser) {
      const initDefault = async () => {
        try {
          const newGraph = await Graph.importJSON(datasets[0].data);
          if (!isMounted) return;
          
          setGraph(newGraph);
          const newEngine = new CypherEngine(newGraph);
          setEngine(newEngine);
          
          const result = await newEngine.execute("MATCH (n)-[r]->(m) return  n, r, m LIMIT 100");
          if (!isMounted) return;
          
          setLastQueryResult(result);
        } catch (e) {
          console.error("Failed to auto-initialize graph", e);
        }
      };
      initDefault();
    }
    return () => { isMounted = false; };
  }, [isBrowser]);

  const handleDatasetSelect = (ds: Dataset) => {
    setActiveDataset(ds);
    setDataInput(JSON.stringify(ds.data, null, 2));
  };

  const handleInitializeGraph = async () => {
    try {
      console.log("Initializing graph with data:", dataInput);
      const parsedData = JSON.parse(dataInput);
      // We create a new Graph instance with the imported data
      const newGraph = await Graph.importJSON(parsedData);
      setGraph(newGraph);
      const newEngine = new CypherEngine(newGraph);
      setEngine(newEngine);
      
      // Update Visualizer with all nodes
      const result = await newEngine.execute("MATCH (n)-[r]->(m) return  n, r, m LIMIT 100");
      setLastQueryResult(result);
      setSelectedElement(null);
      
      setInitStatus({ message: 'Graph initialized!', type: 'success' });
      setTimeout(() => setInitStatus(null), 3000);
    } catch (e: any) {
      setInitStatus({ message: `Failed: ${e.message}`, type: 'error' });
      setTimeout(() => setInitStatus(null), 5000);
    }
  };

  const handleRunQuery = async () => {
    if (!engine) return;
    try {
      const result = await engine.execute(queryInput, {}, { executionPlan: { format: 'text' } });
      setQueryOutput(JSON.stringify({ columns: result.columns, rows: result.rows }, null, 2));
      setExecutionPlan(result.executionPlan || "No execution plan generated.");
      
      // Update visualizer with query subset
      setLastQueryResult(result);
      setSelectedElement(null);
    } catch (e: any) {
      setQueryOutput(`Error: ${e.message}`);
      setExecutionPlan("");
    }
  };

  if (!isBrowser) {
    return <Layout title="Playground"><div style={{padding: '2rem'}}>Loading Playground...</div></Layout>;
  }

  return (
    <Layout title="Playground" description="Grafio Graph Database Interactive Playground">
      <div className="container margin-vert--lg">
        <h1>Query Playground</h1>
        <p>Experiment with Graph data and Cypher queries entirely in your browser without any server backend.</p>

        <div className={styles.playgroundContainer}>
          <Tabs className="margin-bottom--md" lazy>
            {/* TAB 1: Data Editor */}
            <TabItem value="data" label="Data Editor" default>
              <div className={styles.dataEditorContainer} style={{height: '550px'}}>
                <div className={styles.datasetList}>
                  {datasets.map(ds => (
                    <div 
                      key={ds.id} 
                      className={`${styles.datasetItem} ${activeDataset.id === ds.id ? styles.active : ''}`}
                      onClick={() => handleDatasetSelect(ds)}
                    >
                      <h4>{ds.name}</h4>
                      <p>{ds.description}</p>
                    </div>
                  ))}
                </div>
                <div className={styles.editorPane}>
                  <div className={styles.editorHeader}>
                    <strong>JSON Data</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      {initStatus && (
                        <span style={{ color: initStatus.type === 'success' ? 'var(--ifm-color-success)' : 'var(--ifm-color-danger)', fontSize: '0.9em', fontWeight: 'bold' }}>
                          {initStatus.message}
                        </span>
                      )}
                      <button 
                        className="button button--primary" 
                        onClick={handleInitializeGraph}
                      >
                        Initialize Graph
                      </button>
                    </div>
                  </div>
                  <textarea 
                    className={styles.textarea}
                    value={dataInput}
                    onChange={(e) => setDataInput(e.target.value)}
                    spellCheck={false}
                  />
                </div>
              </div>
            </TabItem>

            {/* TAB 2: Cypher Editor */}
            <TabItem value="cypher" label="Cypher Editor">
              <div className={styles.cypherEditorContainer} style={{height: '550px'}}>
                <PanelGroup direction="vertical">
                  <Panel defaultSize={40} minSize={20}>
                    <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
                      <div className={styles.panelHeader}>
                        <span>Cypher Query</span>
                        <button className="button button--sm button--success" onClick={handleRunQuery}>
                          Run Query
                        </button>
                      </div>
                      <textarea 
                        className={styles.textarea}
                        style={{borderTop: 'none', borderRadius: 0}}
                        value={queryInput}
                        onChange={(e) => setQueryInput(e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  </Panel>
                  <PanelResizeHandle className={`${styles.resizeHandle} ${styles.resizeHandleVertical}`} />
                  <Panel defaultSize={60} minSize={30}>
                    <PanelGroup direction="horizontal">
                      <Panel defaultSize={60} minSize={20}>
                        <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
                          <div className={styles.panelHeader}>Output</div>
                          <pre className={styles.outputArea}>
                            {queryOutput}
                          </pre>
                        </div>
                      </Panel>
                      <PanelResizeHandle className={`${styles.resizeHandle} ${styles.resizeHandleHorizontal}`} />
                      <Panel defaultSize={40} minSize={20}>
                        <div style={{display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid var(--ifm-color-emphasis-300)'}}>
                          <div className={styles.panelHeader}>Execution Plan</div>
                          <pre className={styles.outputArea}>
                            {executionPlan}
                          </pre>
                        </div>
                      </Panel>
                    </PanelGroup>
                  </Panel>
                </PanelGroup>
              </div>
            </TabItem>

            {/* TAB 3: Visualizer */}
            <TabItem value="visualizer" label="Visualizer">
              <div className={styles.cypherEditorContainer} style={{height: '550px'}}>
                <div className={styles.panelHeader} style={{ flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span>Response Data Visualisation</span>
                    <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.85em', gap: '0.25rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={showPermanentLabels} 
                        onChange={(e) => setShowPermanentLabels(e.target.checked)} 
                      />
                      Node Labels
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.85em', gap: '0.25rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={showEdgeLabels} 
                        onChange={(e) => setShowEdgeLabels(e.target.checked)} 
                      />
                      Edge Type
                    </label>
                  </div>
                  <div>
                    <button 
                      className={`button button--sm margin-right--sm ${visualizerMode === '2d' ? 'button--primary' : 'button--secondary'}`} 
                      onClick={() => setVisualizerMode('2d')}
                    >2D Mode</button>
                    <button 
                      className={`button button--sm ${visualizerMode === '3d' ? 'button--primary' : 'button--secondary'}`} 
                      onClick={() => setVisualizerMode('3d')}
                    >3D Mode</button>
                  </div>
                </div>
                <PanelGroup direction="horizontal">
                  <Panel defaultSize={80} minSize={50}>
                    {!lastQueryResult ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ifm-color-emphasis-500)', fontStyle: 'italic', backgroundColor: 'var(--ifm-color-emphasis-100)' }}>
                        Run a query to show its visualization
                      </div>
                    ) : (
                      <VisualizerComponent 
                        mode={visualizerMode} 
                        lastQueryResult={lastQueryResult} 
                        isBrowser={isBrowser}
                        showPermanentLabels={showPermanentLabels}
                        showEdgeLabels={showEdgeLabels}
                        onNodeClick={(node) => setSelectedElement({ type: 'Node', data: node })}
                        onLinkClick={(link) => setSelectedElement({ type: 'Edge', data: link })}
                      />
                    )}
                  </Panel>
                  <PanelResizeHandle className={`${styles.resizeHandle} ${styles.resizeHandleHorizontal}`} />
                  <Panel defaultSize={20} minSize={15}>
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid var(--ifm-color-emphasis-300)' }}>
                      <div className={styles.panelHeader}>
                        <span>Selected Object</span>
                        {selectedElement && (
                          <button 
                            className="button button--sm button--secondary" 
                            style={{ padding: '0.1rem 0.4rem', fontSize: '0.7em' }}
                            onClick={() => setSelectedElement(null)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className={styles.outputArea} style={{ flex: 1, overflowY: 'auto' }}>
                        {selectedElement ? (
                          <>
                            <strong style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--ifm-color-primary)' }}>
                              {selectedElement.type}: {selectedElement.data.label || selectedElement.data.name || selectedElement.data.id}
                            </strong>
                            <pre style={{ margin: 0, fontSize: '0.85em', backgroundColor: 'transparent', padding: 0 }}>
                              {JSON.stringify(selectedElement.data.data, null, 2)}
                            </pre>
                          </>
                        ) : (
                          <div style={{ color: 'var(--ifm-color-emphasis-500)', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                            Click on any node or edge in the visualizer to view its raw data properties here.
                          </div>
                        )}
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              </div>
            </TabItem>
          </Tabs>
        </div>
      </div>
    </Layout>
  );
}
