/**
 * Formatter for query execution plans.
 *
 * Converts a {@link QueryPlan} into different output formats:
 * - 'json'    → JSON string representation
 * - 'text'   → ASCII tree diagram
 * - 'mermaid' → Mermaid flowchart syntax
 *
 * @module cypher/plan/PlanFormatter
 */

import { Expression } from '../ast/AstNode';
import { QueryPlan, PlanStep, PropertyFilter, PlanExecutionStats } from './QueryPlan';

/**
 * Supported output formats for execution plan visualization.
 */
export type PlanFormat = 'json' | 'text' | 'mermaid';

/**
 * Formats a {@link QueryPlan} into various output formats for visualization
 * and debugging purposes.
 */
export class PlanFormatter {
  /**
   * Format a query plan into the specified output format.
   *
   * @param plan   - The query plan to format.
   * @param format - The output format: 'json' | 'text' | 'mermaid'.
   * @param executionStats - Optional execution statistics to include in output.
   * @returns A formatted string representation of the plan.
   */
  format(plan: QueryPlan, format: PlanFormat = 'json', executionStats?: PlanExecutionStats, params?: Record<string, unknown>): string {
    switch (format) {
      case 'json':
        return this.toJson(plan, executionStats, params);
      case 'text':
        return this.toText(plan, executionStats, params);
      case 'mermaid':
        return this.toMermaid(plan, executionStats, params);
      default:
        throw new Error(`Unsupported plan format: ${String(format)}`);
    }
  }

  /**
   * Convert plan to JSON string.
   */
  private toJson(plan: QueryPlan, executionStats?: PlanExecutionStats, _params?: Record<string, unknown>): string {
    const output: { plan: QueryPlan; executionStats?: PlanExecutionStats } = { plan };
    if (executionStats) {
      output.executionStats = executionStats;
    }
    return JSON.stringify(output, this._jsonReplacer, 2);
  }

  /**
   * JSON replacer that converts Infinity to null so the output is valid JSON.
   * When parsing back, null can be interpreted as unbounded/infinite.
   */
  private _jsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return null;
    }
    return value;
  }

  /**
   * Convert plan to ASCII tree diagram.
   */
  private toText(plan: QueryPlan, executionStats?: PlanExecutionStats, params?: Record<string, unknown>): string {
    const lines: string[] = [];
    const steps = plan.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isLast = i === steps.length - 1;
      const prefix = isLast ? '\u2514\u2014 ' : '\u251c\u2014 ';
      const stepDescription = this.describeStep(step, params);
      const statsSuffix = this.getStepStatsSuffix(executionStats, i);
      lines.push(prefix + stepDescription + statsSuffix);
    }

    return lines.join('\n');
  }

  /**
   * Convert plan to Mermaid flowchart syntax.
   */
  private toMermaid(plan: QueryPlan, executionStats?: PlanExecutionStats, params?: Record<string, unknown>): string {
    const lines: string[] = ['flowchart LR'];
    const steps = plan.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const currentNode = 'Step' + (i + 1);
      const currentLabel = this.escapeMermaid(this.describeStepForMermaid(step, params));
      const statsSuffix = this.getStepStatsSuffix(executionStats, i);
      const escapedStatsSuffix = this.escapeMermaid(statsSuffix);
      lines.push(' ' + currentNode + '[' + currentLabel + escapedStatsSuffix + ']');

      if (i > 0) {
        const prevNode = 'Step' + i;
        lines.push(' ' + prevNode + ' --> ' + currentNode);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get the statistics suffix for a step (e.g., " (5ms, 50%, 10 rows)").
   */
  private getStepStatsSuffix(executionStats?: PlanExecutionStats, stepIndex?: number): string {
    if (!executionStats || stepIndex === undefined) {
      return '';
    }
    const stepStats = executionStats.steps[stepIndex];
    if (!stepStats) {
      return '';
    }
    return ` (${stepStats.timeMs}ms, ${stepStats.percentageOfTotal.toFixed(1)}%, ${stepStats.rowsOut} rows)`;
  }

  /**
   * Generate a description of a plan step suitable for Mermaid labels.
   * Uses angle brackets instead of parentheses for safety.
   */
  private describeStepForMermaid(step: PlanStep, _params?: Record<string, unknown>): string {
    switch (step.kind) {
      case 'NodeScanStep':
        const filters = step.propertyFilters?.map(f => this.getPropertyFilterDescription(f)).join(', ') || '';
        return 'NodeScanStep ' + step.variable + (step.types && step.types.length ? ':' + step.types.join('|') : '') + (filters ? ' { ' + filters + ' }' : '');

      case 'NodeSeekStep':
        const nodeSeekVal = this.formatValue(step.value, _params);
        if (step.index === 'id') {
          return 'NodeSeekStep id=' + nodeSeekVal;
        }
        return 'NodeSeekStep ' + step.key + '=' + nodeSeekVal;

      case 'EdgeExpandStep': {
        const dir = step.direction === 'out' ? '->' : '<-';
        const edgeVar = step.edgeVar ? ' ' + step.edgeVar : '';
        const edgeTypes = step.types?.length ? ':' + step.types.join('|') : '';
        const targetTypes = step.targetTypes?.length ? ':' + step.targetTypes.join('|') : '';
        const hops = step.minHops === step.maxHops
          ? (step.minHops === 1 ? '' : '[*' + step.minHops + ']')
          : '[*' + step.minHops + '..' + (step.maxHops === Infinity ? '*' : step.maxHops) + ']';
        const strategy = step.strategy !== 'single-hop' ? ' ' + step.strategy : '';
        return 'EdgeExpandStep' + edgeVar + edgeTypes + ' ' + dir + ' ' + step.target + targetTypes + hops + strategy;
      }

      case 'FilterStep':
        return 'FilterStep ' + this.getExpressionDescription(step.predicate);

      case 'ProjectStep': {
        const cols = step.columns.map(c => c.alias).join(', ');
        return 'ProjectStep' + (cols ? ' ' + cols : '') + (step.distinct ? ' DISTINCT' : '');
      }

      case 'SortStep': {
        const items = step.items.map(
          item => this.getExpressionDescription(item.expression) + ' ' + item.direction
        ).join(', ');
        return 'SortStep' + (items ? ' ' + items : '');
      }

      case 'LimitStep': {
        let limitDesc = 'LimitStep';
        if (step.skipExpr) limitDesc += ' SKIP ' + this.getExpressionDescription(step.skipExpr);
        if (step.limitExpr) limitDesc += ' LIMIT ' + this.getExpressionDescription(step.limitExpr);
        return limitDesc;
      }

      case 'AggregateStep': {
        const funcs = step.aggregates.map(a => a.function + '(' + a.alias + ')').join(', ');
        return 'AggregateStep' + (funcs ? ' ' + funcs : '');
      }

      case 'CreateNodeStep':
        return 'CreateNodeStep ' + step.variable + ':' + step.labels.join('|') + ' ' + JSON.stringify(step.properties);

      case 'CreateEdgeStep':
        return 'CreateEdgeStep ' + step.variable + ':(' + step.source + ')-[:' + step.types.join('|') + ']->(' + step.target + ') ' + JSON.stringify(step.properties);

      case 'SetPropertyStep':
        const assignments = step.assignments.map(a => (a.key ? a.key + ' ' + a.operator + ' ' : a.operator + ' ') + this.getExpressionDescription(a.value)).join(', ');
        return 'SetPropertyStep ' + step.variable + '.' + step.entityKind + ' ' + assignments;

      case 'DeleteEntityStep':
        return 'DeleteEntityStep ' + step.variable + '.' + step.entityKind + (step.detach ? ' DETACH' : '');

      case 'RemovePropertyStep':
        return 'RemovePropertyStep ' + step.variable + '.' + step.entityKind + ' ' + step.property;
      case 'RemoveLabelStep':
        return 'RemoveLabelStep ' + step.variable + ':' + step.labels.join(':');

      case 'CreateIndexStep':
        return 'CreateIndexStep ' + step.name + ' target=' + step.target + ' keys=[' + step.propertyKeys.join(', ') + ']';

      case 'DropIndexStep':
        return 'DropIndexStep ' + step.name;

      case 'ShowIndexesStep':
        return 'ShowIndexesStep columns=[' + step.columns.map(c => c.alias).join(', ') + ']';

      case 'OptionalMatchStep': {
        const subSteps = step.readSteps.map(s => this.describeStepForMermaid(s, _params)).join(', ');
        return 'OptionalMatchStep [newVars: ' + step.newVars.join(', ') + '] { ' + subSteps + ' }';
      }

      case 'MergeStep': {
        const readDesc = step.readSteps.map(s => this.describeStepForMermaid(s, _params)).join(', ');
        const createDesc = step.createSteps.map(s => this.describeStepForMermaid(s, _params)).join(', ');
        let onMatch = '';
        if (step.onMatchItems && step.onMatchItems.length > 0) {
          onMatch = ' ON MATCH SET ' + step.onMatchItems.map(a => (a.property ? a.variable + '.' + a.property : a.variable) + ' ' + a.operator + ' ' + this.getExpressionDescription(a.value)).join(', ');
        }
        let onCreate = '';
        if (step.onCreateItems && step.onCreateItems.length > 0) {
          onCreate = ' ON CREATE SET ' + step.onCreateItems.map(a => (a.property ? a.variable + '.' + a.property : a.variable) + ' ' + a.operator + ' ' + this.getExpressionDescription(a.value)).join(', ');
        }
        return 'MergeStep { read: [' + readDesc + '], create: [' + createDesc + '] }' + onMatch + onCreate;
      }

      case 'ExistsSubqueryStep': {
        const subStepsDesc = step.subPlan.map(s => this.describeStepForMermaid(s, _params)).join(', ');
        return 'ExistsSubqueryStep [' + step.resultVariable + '] { ' + subStepsDesc + ' }';
      }

      case 'VerifyNodeStep': {
        const types = step.types?.length ? ':' + step.types.join('|') : (step.label ? ':' + step.label : '');
        const filters = step.propertyFilters?.map(f => this.getPropertyFilterDescription(f)).join(', ') || '';
        return 'VerifyNodeStep ' + step.variable + types + (filters ? ' { ' + filters + ' }' : '');
      }

      case 'PatternComprehensionStep': {
        const subStepsDesc = step.subPlan.map(s => this.describeStepForMermaid(s, _params)).join(', ');
        return 'PatternComprehensionStep [' + step.resultVariable + '] { ' + subStepsDesc + ' | ' + this.getExpressionDescription(step.projection) + ' }';
      }

      case 'PatternExprStep': {
        const subStepsDesc = step.subPlan.map(s => this.describeStepForMermaid(s, _params)).join(', ');
        return 'PatternExprStep [' + step.resultVariable + '=(' + step.pathVariables.join(', ') + ')] { ' + subStepsDesc + ' }';
      }

      case 'UnionStep': {
        const desc = step.plans.map((p, i) => {
          const subStepsDesc = p.steps.map(s => this.describeStepForMermaid(s, _params)).join(', ');
          const unionType = i > 0 ? (step.all[i - 1] ? ' UNION ALL ' : ' UNION ') : '';
          return unionType + '{ ' + subStepsDesc + ' }';
        }).join('');
        return 'UnionStep ' + desc;
      }

      case 'UnwindStep':
        return 'UnwindStep ' + step.variable + ' IN ' + this.getExpressionDescription(step.expression);

      default:
        return (step as PlanStep).kind;
    }
  }

  /**
   * Generate a short human-readable description of a plan step.
   */
  private describeStep(step: PlanStep, params?: Record<string, unknown>): string {
    switch (step.kind) {
      case 'NodeScanStep':
        const scanFilters = step.propertyFilters?.map(f => this.getPropertyFilterDescription(f)).join(', ') || '';
        return 'NodeScanStep (' + step.variable + (step.types && step.types.length ? ':' + step.types.join('|') : '') + (scanFilters ? ' { ' + scanFilters + ' }' : '') + ')';

      case 'NodeSeekStep':
        const seekValue = this.formatValue(step.value, params);
        if (step.index === 'id') {
          return 'NodeSeekStep [id=' + seekValue + ']';
        }
        return 'NodeSeekStep [' + step.key + '=' + seekValue + ']';

      case 'EdgeExpandStep': {
        const dir = step.direction === 'out' ? '\u2192' : '\u2190';
        const edgeVar = step.edgeVar ? ' ' + step.edgeVar : '';
        const edgeTypes = step.types?.length ? ':' + step.types.join('|') : '';
        const targetTypes = step.targetTypes?.length ? ':' + step.targetTypes.join('|') : '';
        const hops = step.minHops === step.maxHops
          ? (step.minHops === 1 ? '' : '[*' + step.minHops + ']')
          : '[*' + step.minHops + '..' + (step.maxHops === Infinity ? '*' : step.maxHops) + ']';
        const strategy = step.strategy !== 'single-hop' ? ' ' + step.strategy : '';
        return 'EdgeExpandStep (' + dir + ')' + edgeVar + edgeTypes + ' \u2192 ' + step.target + targetTypes + hops + strategy;
      }

      case 'FilterStep':
        return 'FilterStep ' + this.getExpressionDescription(step.predicate);

      case 'ProjectStep': {
        const cols = step.columns.map(c => c.alias).join(', ');
        return 'ProjectStep [' + cols + ']' + (step.distinct ? ' DISTINCT' : '');
      }

      case 'SortStep': {
        const items = step.items.map(
          item => this.getExpressionDescription(item.expression) + ' ' + item.direction
        ).join(', ');
        return 'SortStep [' + items + ']';
      }

      case 'LimitStep': {
        let limitDesc = 'LimitStep';
        if (step.skipExpr) limitDesc += ' SKIP ' + this.getExpressionDescription(step.skipExpr);
        if (step.limitExpr) limitDesc += ' LIMIT ' + this.getExpressionDescription(step.limitExpr);
        return limitDesc;
      }

      case 'AggregateStep': {
        const funcs = step.aggregates.map(a => a.function + '(' + a.alias + ')').join(', ');
        return 'AggregateStep [' + funcs + ']';
      }

      case 'CreateNodeStep':
        return 'CreateNodeStep [' + step.variable + ':' + step.labels.join('|') + ' ' + JSON.stringify(step.properties) + ']';

      case 'CreateEdgeStep':
        return 'CreateEdgeStep [' + step.variable + ':(' + step.source + ')-[:' + step.types.join('|') + ']->(' + step.target + ') ' + JSON.stringify(step.properties) + ']';

      case 'SetPropertyStep':
        const assignments2 = step.assignments.map(a => (a.key ? a.key + ' ' + a.operator + ' ' : a.operator + ' ') + this.getExpressionDescription(a.value)).join(', ');
        return 'SetPropertyStep [' + step.variable + '.' + step.entityKind + ' ' + assignments2 + ']';

      case 'DeleteEntityStep':
        return 'DeleteEntityStep [' + step.variable + '.' + step.entityKind + (step.detach ? ' DETACH' : '') + ']';

      case 'RemovePropertyStep':
        return 'RemovePropertyStep [' + step.variable + '.' + step.entityKind + ' ' + step.property + ']';
      case 'RemoveLabelStep':
        return 'RemoveLabelStep [' + step.variable + ':' + step.labels.join(':') + ']';

      case 'CreateIndexStep':
        return 'CreateIndexStep [' + step.name + ' target=' + step.target + ' keys=(' + step.propertyKeys.join(', ') + ')]';

      case 'DropIndexStep':
        return 'DropIndexStep [' + step.name + ']';

      case 'ShowIndexesStep':
        return 'ShowIndexesStep [columns: ' + step.columns.map(c => c.alias).join(', ') + ']';

      case 'OptionalMatchStep': {
        const subStepsDesc = step.readSteps.map(s => this.describeStep(s, params)).join(', ');
        return 'OptionalMatchStep [newVars: ' + step.newVars.join(', ') + '] { ' + subStepsDesc + ' }';
      }

      case 'MergeStep': {
        const readDesc = step.readSteps.map(s => this.describeStep(s, params)).join(', ');
        const createDesc = step.createSteps.map(s => this.describeStep(s, params)).join(', ');
        let onMatch = '';
        if (step.onMatchItems && step.onMatchItems.length > 0) {
          onMatch = ' ON MATCH SET ' + step.onMatchItems.map(a => (a.property ? a.variable + '.' + a.property : a.variable) + ' ' + a.operator + ' ' + this.getExpressionDescription(a.value)).join(', ');
        }
        let onCreate = '';
        if (step.onCreateItems && step.onCreateItems.length > 0) {
          onCreate = ' ON CREATE SET ' + step.onCreateItems.map(a => (a.property ? a.variable + '.' + a.property : a.variable) + ' ' + a.operator + ' ' + this.getExpressionDescription(a.value)).join(', ');
        }
        return 'MergeStep { read: [' + readDesc + '], create: [' + createDesc + '] }' + onMatch + onCreate;
      }

      case 'ExistsSubqueryStep': {
        const subStepsDesc = step.subPlan.map(s => this.describeStep(s, params)).join(', ');
        return 'ExistsSubqueryStep [' + step.resultVariable + '] { ' + subStepsDesc + ' }';
      }

      case 'VerifyNodeStep': {
        const types = step.types?.length ? ':' + step.types.join('|') : (step.label ? ':' + step.label : '');
        const filters = step.propertyFilters?.map(f => this.getPropertyFilterDescription(f)).join(', ') || '';
        return 'VerifyNodeStep [' + step.variable + types + (filters ? ' { ' + filters + ' }' : '') + ']';
      }

      case 'PatternComprehensionStep': {
        const subStepsDesc = step.subPlan.map(s => this.describeStep(s, params)).join(', ');
        return 'PatternComprehensionStep [' + step.resultVariable + '] { ' + subStepsDesc + ' | ' + this.getExpressionDescription(step.projection) + ' }';
      }

      case 'PatternExprStep': {
        const subStepsDesc = step.subPlan.map(s => this.describeStep(s, params)).join(', ');
        return 'PatternExprStep [' + step.resultVariable + '=(' + step.pathVariables.join(', ') + ')] { ' + subStepsDesc + ' }';
      }

      case 'UnionStep': {
        const desc = step.plans.map((p, i) => {
          const subStepsDesc = p.steps.map(s => this.describeStep(s, params)).join(', ');
          const unionType = i > 0 ? (step.all[i - 1] ? ' UNION ALL ' : ' UNION ') : '';
          return unionType + '{ ' + subStepsDesc + ' }';
        }).join('');
        return 'UnionStep ' + desc;
      }

      case 'UnwindStep':
        return 'UnwindStep [' + step.variable + ' IN ' + this.getExpressionDescription(step.expression) + ']';

      default:
        return (step as PlanStep).kind;
    }
  }

  private getExpressionDescription(expr: Expression): string {
    switch (expr.kind) {
      case 'Literal':
        return JSON.stringify(expr.value);
      case 'Identifier':
        return expr.name;
      case 'PropertyAccess':
        return this.getExpressionDescription(expr.object) + '.' + expr.property;
      case 'Binary':
        const binLeft = this.getExpressionDescription(expr.left);
        const binRight = this.getExpressionDescription(expr.right);
        const binOp = expr.op;
        if (binOp === 'AND' || binOp === 'OR') {
          return '(' + binLeft + ' ' + binOp + ' ' + binRight + ')';
        }
        return binLeft + ' ' + binOp + ' ' + binRight;
      case 'Unary':
        return expr.op + this.getExpressionDescription(expr.operand);
      case 'In':
        const inOp = expr.not ? 'NOT IN' : 'IN';
        return (
          this.getExpressionDescription(expr.expression) +
          ' ' + inOp + ' ' +
          this.getExpressionDescription(expr.list)
        );
      case 'IsNull':
        const nullOp = expr.not ? 'IS NOT NULL' : 'IS NULL';
        return this.getExpressionDescription(expr.expression) + ' ' + nullOp;
      case 'List':
        return '[' + expr.elements.map(e => this.getExpressionDescription(e)).join(', ') + ']';
      case 'Parameter':
        return '$' + expr.name;
      case 'FunctionCall':
        const args = expr.args.map(a => this.getExpressionDescription(a)).join(', ');
        return expr.name + '(' + (expr.distinct ? 'DISTINCT ' : '') + args + ')';
      case 'ExistsSubquery':
        return 'EXISTS { ... }';
      case 'Map':
        return '{' + Object.entries(expr.props).map(([k, v]) => k + ': ' + this.getExpressionDescription(v)).join(', ') + '}';
      case 'ListComprehension': {
        let desc = '[' + expr.variable + ' IN ' + this.getExpressionDescription(expr.list);
        if (expr.where) {
          desc += ' WHERE ' + this.getExpressionDescription(expr.where);
        }
        if (expr.projection) {
          desc += ' | ' + this.getExpressionDescription(expr.projection);
        }
        desc += ']';
        return desc;
      }
      case 'PatternComprehension': {
        let desc = '[';
        if (expr.where) {
          desc += ' WHERE ' + this.getExpressionDescription(expr.where);
        }
        desc += ' | ' + this.getExpressionDescription(expr.projection) + ']';
        return desc;
      }
      case 'PatternExpr':
        return '(pattern)';
      case 'Case': {
        let desc = 'CASE';
        if (expr.expression) desc += ' ' + this.getExpressionDescription(expr.expression);
        for (const branch of expr.branches) {
          desc += ' WHEN ' + this.getExpressionDescription(branch.when) + ' THEN ' + this.getExpressionDescription(branch.then);
        }
        if (expr.else) desc += ' ELSE ' + this.getExpressionDescription(expr.else);
        desc += ' END';
        return desc;
      }
      case 'ListPredicate': {
        let desc = expr.predicate;
        desc += '(' + expr.variable + ' IN ' + this.getExpressionDescription(expr.list) + ' WHERE ' + this.getExpressionDescription(expr.where) + ')';
        return desc;
      }
    }
  }

  private getPropertyFilterDescription(filter: PropertyFilter): string {
    let desc = '';
    if (filter.key) {
      desc += filter.key;
    }
    if (filter.op) {
      desc += ' ' + filter.op;
    }
    if (filter.value !== undefined) {
      desc += ' ' + JSON.stringify(filter.value);
    }
    if (filter.AND) {
      const andDesc = filter.AND.map(f => this.getPropertyFilterDescription(f)).join(' AND ');
      desc += (desc ? ' AND ' : '') + '(' + andDesc + ')';
    }
    if (filter.OR) {
      const orDesc = filter.OR.map(f => this.getPropertyFilterDescription(f)).join(' OR ');
      desc += (desc ? ' OR ' : '') + '(' + orDesc + ')';
    }
    return desc || '(no filters)';
  }

  /**
   * Format a value for display in plan output.
   * Handles Parameter expressions by returning $name or $name=value if params provided.
   */
  private formatValue(value: unknown, params?: Record<string, unknown>): string {
    if (value && typeof value === 'object' && (value as Record<string, unknown>).kind === 'Parameter') {
      const name = (value as { name: string }).name;
      if (params && name in params) {
        return '$' + name + '=' + JSON.stringify(params[name]);
      }
      return '$' + name;
    }
    return JSON.stringify(value);
  }

  /**
   * Escape special characters for Mermaid diagram labels.
   */
  private escapeMermaid(text: string): string {
    return text
      .replace(/&/g, String.fromCharCode(38, 97, 109, 112, 59)) // &amp;
      .replace(/</g, String.fromCharCode(38, 108, 116, 59)) // &lt;
      .replace(/>/g, String.fromCharCode(38, 103, 116, 59)) // &gt;
      .replace(/{/g, String.fromCharCode(38, 108, 99, 117, 98, 59)) // &lcub;
      .replace(/}/g, String.fromCharCode(38, 114, 99, 117, 98, 59)) // &rcub;
      .replace(/\(/g, String.fromCharCode(38, 108, 112, 97, 114, 59)) // &lpar;
      .replace(/\)/g, String.fromCharCode(38, 114, 112, 97, 114, 59)) // &rpar;
      .replace(/\[/g, String.fromCharCode(38, 108, 98, 114, 97, 99, 107, 59)) // &lbrack;
      .replace(/\]/g, String.fromCharCode(38, 114, 98, 114, 97, 99, 107, 59)) // &rbrack;
      .replace(/"/g, String.fromCharCode(38, 113, 117, 111, 116, 59)) // &quot;
      .replace(/\x27/g, String.fromCharCode(38, 97, 112, 111, 115, 59)) // &apos;
      .replace(/\n/g, '<br/>');
  }
}