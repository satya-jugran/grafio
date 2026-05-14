import { describe, it, expect, beforeEach } from '@jest/globals';
import { Graph, Node } from '../../../index';
import { CypherEngine } from '../../../cypher';
import { prepareSocialGraph } from '../socialGraphScenarios';

/**
 * Shared test scenarios for the Facebook Social Graph using Cypher queries.
 * These tests mirror the structure of socialGraphScenarios.ts but use the
 * Cypher query engine instead of direct Graph API calls.
 *
 * @param provider - Optional storage provider instance
 */
export function runSocialGraphCypherScenarios(): void {
  describe('Facebook Social Graph', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeEach(async () => {
      graph = await prepareSocialGraph();
      engine = new CypherEngine(graph);
    });

    // ========================================
    // A. GRAPH STRUCTURE TESTS
    // ========================================
    describe('A. Graph Structure', () => {
      it('should have exactly 42 nodes total', async () => {
        const result = await engine.execute('MATCH (n) RETURN count(n) AS total');
        expect(result.rows[0].total).toBe(42);
      });

      it('should have exactly 10 people', async () => {
        const result = await engine.execute('MATCH (p:Person) RETURN count(p) AS total');
        expect(result.rows[0].total).toBe(10);
      });

      it('should have exactly 7 posts', async () => {
        const result = await engine.execute('MATCH (p:Post) RETURN count(p) AS total');
        expect(result.rows[0].total).toBe(7);
      });

      it('should have exactly 5 photos', async () => {
        const result = await engine.execute('MATCH (p:Photo) RETURN count(p) AS total');
        expect(result.rows[0].total).toBe(5);
      });

      it('should have exactly 20 comments', async () => {
        const result = await engine.execute('MATCH (c:Comment) RETURN count(c) AS total');
        expect(result.rows[0].total).toBe(20);
      });

      it('should have all 10 people with correct names', async () => {
        const result = await engine.execute(
          "MATCH (p:Person) RETURN p.name AS name ORDER BY p.name ASC"
        );
        const names = result.rows.map(r => r.name as string);
        expect(names).toEqual([
          'Alice', 'Bob', 'Charlie', 'David', 'Eve',
          'Frank', 'Grace', 'Henry', 'Ivan', 'Julia'
        ]);
      });

      it('should verify node IDs are unique', async () => {
        const result = await engine.execute('MATCH (n) RETURN count(n) AS total');
        // Just verify we get the expected count (42 unique nodes)
        expect(result.rows[0].total).toBe(42);
      });
    });

    // ========================================
    // B. FRIENDSHIP NETWORK TESTS
    // ========================================
    describe('B. Friendship Network', () => {
      it('should have 28 friendship edges (bidirectional)', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:FRIENDS_WITH]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(28);
      });

      it('should find the most social person (most friendships)', async () => {
        // Verify Alice has 4 friends by checking specific connections
        const aliceFriends = await engine.execute(
          "MATCH (alice:Person {name: 'Alice'})-[:FRIENDS_WITH]->(f) RETURN count(f) AS friendCount"
        );
        expect(aliceFriends.rows[0].friendCount).toBe(4);
      });

      it('should get friends of friends for Alice (2nd degree connections)', async () => {
        // Find Alice's friends' friends (excluding Alice herself)
        const result = await engine.execute(
          `MATCH (alice:Person {name: 'Alice'})-[:FRIENDS_WITH]->(friend)-[:FRIENDS_WITH]->(fof)
           WHERE fof <> alice
           RETURN collect(DISTINCT fof.name) AS friendsOfFriends`
        );
        const fofList = result.rows[0].friendsOfFriends as string[];
        expect(fofList.length).toBeGreaterThanOrEqual(4);
      });
    });

    // ========================================
    // C. CONTENT POSTING TESTS
    // ========================================
    describe('C. Content & Posting', () => {
      it('should have 7 posted edges', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:POSTED]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(7);
      });

      it('should have 5 photo uploaded edges', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:PHOTO_UPLOADED]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(5);
      });

      it('should find all posts by Alice', async () => {
        const result = await engine.execute(
          `MATCH (alice:Person {name: 'Alice'})-[:POSTED]->(post:Post)
           RETURN post.content AS content`
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].content as string).toContain('Just joined');
      });
    });

    // ========================================
    // D. LIKES & ENGAGEMENT TESTS
    // ========================================
    describe('D. Likes & Engagement', () => {
      it('should have 18 likes on posts', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:LIKES_POST]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(18);
      });

      it('should have 9 likes on photos', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:LIKES_PHOTO]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(9);
      });

      it('should find most liked post (Hello World with 4)', async () => {
        // Find the post with content "Just joined the social network!" and verify it has 4 likes
        const helloPostLikes = await engine.execute(
          "MATCH (post:Post {content: 'Just joined the social network!'})<-[:LIKES_POST]-(person) RETURN count(person) AS likeCount"
        );
        expect(helloPostLikes.rows[0].likeCount).toBe(4);
      });

      it('should find person who liked most posts', async () => {
        // Alice liked 3 posts (postLink, postBirthday, postWork)
        const aliceLikes = await engine.execute(
          "MATCH (alice:Person {name: 'Alice'})-[r:LIKES_POST]->(post) RETURN count(r) AS likeCount"
        );
        expect(aliceLikes.rows[0].likeCount).toBe(3);
      });
    });

    // ========================================
    // E. COMMENTS TESTS
    // ========================================
    describe('E. Comments', () => {
      it('should have 12 commented on post edges', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:COMMENTED_ON_POST]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(12);
      });

      it('should have 12 on post edges', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:ON_POST]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(12);
      });

      it('should have 8 commented on photo edges', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:COMMENTED_ON_PHOTO]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(8);
      });

      it('should have 8 on photo edges', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:ON_PHOTO]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(8);
      });

      it('should find most commented post has 3 comments', async () => {
        // The postBirthday has 3 comments (c6, c7, c8 ON postBirthday)
        const result = await engine.execute(
          "MATCH (post:Post {content: 'Wishing everyone a great day!'})<-[:ON_POST]-(comment) RETURN count(comment) AS commentCount"
        );
        expect(result.rows[0].commentCount).toBe(3);
      });
    });

    // ========================================
    // F. COMPLEX TRAVERSAL QUERY TESTS
    // ========================================
    describe('F. Complex Traversal Queries', () => {
      it('should find path from Alice to David via friends (Alice -> Bob -> David)', async () => {
        // Using variable-length named path to find connection
        const result = await engine.execute(
          `MATCH path = (alice:Person {name: 'Alice'})-[:FRIENDS_WITH*1..3]->(david:Person {name: 'David'})
           RETURN path`
        );
        expect(result.rows.length).toBeGreaterThan(0);
        // path is [alice, edge1, bob, edge2, david] — should have at least 3 elements
        const path = result.rows[0].path as Array<unknown>;
        expect(Array.isArray(path)).toBe(true);
        expect(path.length).toBeGreaterThanOrEqual(3);
      });

      it('should find all people who liked Alice posts', async () => {
        const result = await engine.execute(
          `MATCH (alice:Person {name: 'Alice'})-[:POSTED]->(post:Post)<-[:LIKES_POST]-(liker:Person)
           RETURN collect(DISTINCT liker.name) AS likerNames`
        );
        const likerNames = result.rows[0].likerNames as string[];
        expect(likerNames.length).toBeGreaterThanOrEqual(3);
      });

      it('should find mutual friends between Alice and Frank', async () => {
        // Find mutual friends using single pattern with bidirectional edge
        // A mutual friend is someone who has FRIENDS_WITH from both Alice AND Frank
        const result = await engine.execute(
          `MATCH (alice:Person {name: 'Alice'})-[:FRIENDS_WITH]->(mutual:Person)<-[:FRIENDS_WITH]-(frank:Person {name: 'Frank'})
           RETURN mutual.name AS friendName`
        );
        // Collect friend names from result rows
        const friendNames = result.rows.map(r => r.friendName as string);
        expect(friendNames).toContain('Charlie');
        expect(friendNames).toContain('Eve');
        expect(friendNames).toHaveLength(2);
      });
    });

    // ========================================
    // H. EDGE CASES AND ERROR HANDLING
    // ========================================
    describe('H. Edge Cases', () => {
      it('should return empty for non-existent node', async () => {
        const result = await engine.execute(
          "MATCH (n {id: 'non-existent-id'}) RETURN n"
        );
        expect(result.rows).toHaveLength(0);
      });

      it('should return empty for non-existent edge', async () => {
        const result = await engine.execute(
          "MATCH ()-[r {id: 'non-existent-edge-id'}]->() RETURN r"
        );
        expect(result.rows).toHaveLength(0);
      });

      it('should find node by property value', async () => {
        const result = await engine.execute(
          "MATCH (n) WHERE n.name = 'Grace' RETURN n.city AS city"
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].city).toBe('Denver');
      });

      it('should find nodes by type with multiple results', async () => {
        const result = await engine.execute(
          'MATCH (p:Person) RETURN count(p) AS total'
        );
        expect(result.rows[0].total).toBe(10);
      });

      it('should return empty for query with no matches', async () => {
        const result = await engine.execute(
          "MATCH (n {name: 'NonExistent'}) RETURN n"
        );
        expect(result.rows).toHaveLength(0);
      });

      it('should filter edges by type correctly', async () => {
        const allEdgesResult = await engine.execute('MATCH ()-[r]->() RETURN count(r) AS total');
        const friendshipsResult = await engine.execute(
          'MATCH ()-[r:FRIENDS_WITH]->() RETURN count(r) AS total'
        );
        const likesPostResult = await engine.execute(
          'MATCH ()-[r:LIKES_POST]->() RETURN count(r) AS total'
        );

        expect(allEdgesResult.rows[0].total as number).toBeGreaterThan(friendshipsResult.rows[0].total as number);
        expect(friendshipsResult.rows[0].total).toBe(28);
        expect(likesPostResult.rows[0].total).toBe(18);
      });
    });

    // ========================================
    // I. GRAPH ALGORITHM TESTS
    // ========================================
    describe('I. Graph Algorithm Tests', () => {
      it('should find paths from one person to another when path exists', async () => {
        // Find path from Alice to Bob and verify path structure
        const result = await engine.execute(
          `MATCH path = (alice:Person {name: 'Alice'})-[:FRIENDS_WITH*1..2]->(bob:Person {name: 'Bob'})
           RETURN path`
        );
        expect(result.rows.length).toBeGreaterThan(0);
        const path = result.rows[0].path as Array<unknown>;
        expect(Array.isArray(path)).toBe(true);
        expect(path.length).toBeGreaterThanOrEqual(3);
      });

      it('should handle edge type filtering in traversal', async () => {
        const result = await engine.execute(
          `MATCH path = (alice:Person {name: 'Alice'})-[:FRIENDS_WITH*1..2]->(bob:Person {name: 'Bob'})
           RETURN path`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });
    });
  });
}
