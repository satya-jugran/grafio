/**
 * Formatter for query execution plans.
 *
 * Converts a {@link QueryPlan} into different output formats:
 * - 'json'    → JSON string representation
 * - 'ascii'   → ASCII tree diagram
 * - 'mermaid' → Mermaid flowchart syntax
 *
 * @module cypher/plan/PlanFormatter
 */

import { Expression } from '../ast/AstNode';
import { QueryPlan, PlanStep, PropertyFilter, PlanExecutionStats } from './QueryPlan';

/**
 * Supported output formats for execution plan visualization.
 */
export type PlanFormat = 'json' | 'ascii' | 'mermaid';

/**
 * Formats a {@link QueryPlan} into various output formats for visualization
 * and debugging purposes.
 */
export class PlanFormatter {
  /**
   * Format a query plan into the specified output format.
   *
   * @param plan   - The query plan to format.
   * @param format - The output format: 'json' | 'ascii' | 'mermaid'.
   * @param executionStats - Optional execution statistics to include in output.
   * @returns A formatted string representation of the plan.
   */
  format(plan: QueryPlan, format: PlanFormat, executionStats?: PlanExecutionStats): string {
    switch (format) {
      case 'json':
        return this.toJson(plan, executionStats);
      case 'ascii':
        return this.toAscii(plan, executionStats);
      case 'mermaid':
        return this.toMermaid(plan, executionStats);
    }
  }

  /**
   * Convert plan to JSON string.
   */
  private toJson(plan: QueryPlan, executionStats?: PlanExecutionStats): string {
    const output: { plan: QueryPlan; executionStats?: PlanExecutionStats } = { plan };
    if (executionStats) {
      output.executionStats = executionStats;
    }
    return JSON.stringify(output, null, 2);
  }

  /**
   * Convert plan to ASCII tree diagram.
   */
  private toAscii(plan: QueryPlan, executionStats?: PlanExecutionStats): string {
    const lines: string[] = [];
    const steps = plan.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isLast = i === steps.length - 1;
      const prefix = isLast ? '\u2514\u2014 ' : '\u251c\u2014 ';
      const stepDescription = this.describeStep(step);
      const statsSuffix = this.getStepStatsSuffix(executionStats, i);
      lines.push(prefix + stepDescription + statsSuffix);
    }

    return lines.join('\n');
  }

  /**
   * Convert plan to Mermaid flowchart syntax.
   */
  private toMermaid(plan: QueryPlan, executionStats?: PlanExecutionStats): string {
    const lines: string[] = ['flowchart TD'];
    const steps = plan.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const currentNode = 'Step' + (i + 1);
      const currentLabel = this.escapeMermaid(this.describeStepForMermaid(step));
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
  private describeStepForMermaid(step: PlanStep): string {
    switch (step.kind) {
      case 'NodeScanStep':
        const filters = step.propertyFilters?.map(f => this.getPropertyFilterDescription(f)).join(', ') || '';
        return 'NodeScanStep ' + step.variable + (step.label ? ':' + step.label : '') + (filters ? ' { ' + filters + ' }' : '');

      case 'NodeSeekStep':
        if (step.index === 'id') {
          return 'NodeSeekStep id=' + step.value;
        }
        return 'NodeSeekStep ' + step.key + '=' + step.value;

      case 'EdgeExpandStep': {
        const dir = step.direction === 'out' ? '->' : '<-';
        const edgeVar = step.edgeVar ? ' ' + step.edgeVar : '';
        const targetTypes = step.targetTypes ? ':' + step.targetTypes.join(',') : '';
        return 'EdgeExpandStep' + edgeVar + ' ' + dir + ' ' + step.target + targetTypes;
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

      default:
        return (step as PlanStep).kind;
    }
  }

  /**
   * Generate a short human-readable description of a plan step.
   */
  private describeStep(step: PlanStep): string {
    switch (step.kind) {
      case 'NodeScanStep':
        const scanFilters = step.propertyFilters?.map(f => this.getPropertyFilterDescription(f)).join(', ') || '';
        return 'NodeScanStep (' + step.variable + (step.label ? ':' + step.label : '') + (scanFilters ? ' { ' + scanFilters + ' }' : '') + ')';

      case 'NodeSeekStep':
        if (step.index === 'id') {
          return 'NodeSeekStep [id=' + step.value + ']';
        }
        return 'NodeSeekStep [' + step.key + '=' + step.value + ']';

      case 'EdgeExpandStep': {
        const dir = step.direction === 'out' ? '\u2192' : '\u2190';
        const edgeVar = step.edgeVar ? ' ' + step.edgeVar : '';
        const targetTypes = step.targetTypes ? ':' + step.targetTypes.join(',') : '';
        return 'EdgeExpandStep (' + dir + ')' + edgeVar + ' \u2192 ' + step.target + targetTypes;
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
        return (
          this.getExpressionDescription(expr.left) +
          ' ' +
          expr.op +
          ' ' +
          this.getExpressionDescription(expr.right)
        );
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
      desc += ' AND (' + filter.AND.map(f => this.getPropertyFilterDescription(f)).join(' AND ') + ')';
    }
    if (filter.OR) {
      desc += ' OR (' + filter.OR.map(f => this.getPropertyFilterDescription(f)).join(' OR ') + ')';
    }
    return desc || '(no filters)';
  }

  /**
   * Generate a Mermaid node ID for a given step index.
   */
  private mermaidNodeId(index: number): string {
    return String.fromCharCode(65 + index); // A, B, C, ...
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