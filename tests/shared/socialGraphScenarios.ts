import { afterAll, beforeAll, beforeEach, describe, it, expect } from '@jest/globals';
import { Graph } from '../../src/index';

/**
 * Shared test scenarios for the Facebook Social Graph.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param buildGraph - Factory that returns a fully-built Graph instance (async to support MongoStorageProvider)
 */
export function runSocialGraphScenarios(buildGraph: () => Promise<Graph>): void {
  describe('Facebook Social Graph', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = await buildGraph();
    });

    // ========================================
    // A. GRAPH STRUCTURE TESTS
    // ========================================
    describe('A. Graph Structure', () => {
      it('should have exactly 42 nodes total', async () => {
        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(42);
      });

      it('should have exactly 10 people', async () => {
        const peopleNodes = await graph.getNodesByType('Person');
        expect(peopleNodes).toHaveLength(10);
      });

      it('should have exactly 7 posts', async () => {
        const postNodes = await graph.getNodesByType('Post');
        expect(postNodes).toHaveLength(7);
      });

      it('should have exactly 5 photos', async () => {
        const photoNodes = await graph.getNodesByType('Photo');
        expect(photoNodes).toHaveLength(5);
      });

      it('should have exactly 20 comments', async () => {
        const commentNodes = await graph.getNodesByType('Comment');
        expect(commentNodes).toHaveLength(20);
      });

      it('should have all 10 people with correct names', async () => {
        const peopleNodes = await graph.getNodesByType('Person');
        const names = peopleNodes.map(n => n.properties.name as string).sort();
        expect(names).toEqual([
          'Alice', 'Bob', 'Charlie', 'David', 'Eve',
          'Frank', 'Grace', 'Henry', 'Ivan', 'Julia'
        ]);
      });

      it('should verify node IDs are unique', async () => {
        const allNodes = await graph.getNodes();
        const ids = allNodes.map(n => n.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(allNodes.length);
      });
    });

    // ========================================
    // B. FRIENDSHIP NETWORK TESTS
    // ========================================
    describe('B. Friendship Network', () => {
      it('should have 28 friendship edges (bidirectional)', async () => {
        const friendships = await graph.getEdgesByType('FRIENDS_WITH');
        expect(friendships).toHaveLength(28);
      });

      it('should find the most social person (most friendships)', async () => {
        const allPeople = await graph.getNodesByType('Person');
        let maxFriends = 0;
        let mostSocial = '';

        for (const person of allPeople) {
          const friends = await graph.getChildren(person.id, { filter: { edgeType: 'FRIENDS_WITH' } });
          if (friends.length > maxFriends) {
            maxFriends = friends.length;
            mostSocial = person.properties.name as string;
          }
        }

        expect(mostSocial).toBe('Alice');
        expect(maxFriends).toBe(4);
      });

      it('should get friends of friends for Alice (2nd degree connections)', async () => {
        const allPeople = await graph.getNodesByType('Person');
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const aliceFriends = await graph.getChildren(alice.id, { filter: { edgeType: 'FRIENDS_WITH' } });
        const friendsOfFriends = new Set<string>();

        for (const friend of aliceFriends) {
          const theirFriends = await graph.getChildren(friend.id, { filter: { edgeType: 'FRIENDS_WITH' } });
          for (const fof of theirFriends) {
            if (fof.properties.name !== 'Alice') {
              friendsOfFriends.add(fof.properties.name as string);
            }
          }
        }

        expect(friendsOfFriends.size).toBeGreaterThanOrEqual(4);
      });
    });

    // ========================================
    // C. CONTENT POSTING TESTS
    // ========================================
    describe('C. Content & Posting', () => {
      it('should have 7 posted edges', async () => {
        const postedEdges = await graph.getEdgesByType('POSTED');
        expect(postedEdges).toHaveLength(7);
      });

      it('should have 5 photo uploaded edges', async () => {
        const uploadedEdges = await graph.getEdgesByType('PHOTO_UPLOADED');
        expect(uploadedEdges).toHaveLength(5);
      });

      it('should find all posts by Alice', async () => {
        const allPeople = await graph.getNodesByType('Person');
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const aliceChildren = await graph.getChildren(alice.id, { filter: { edgeType: 'POSTED' } });
        expect(aliceChildren).toHaveLength(1);
        expect(aliceChildren[0].properties.content).toContain('Just joined');
      });
    });

    // ========================================
    // D. LIKES & ENGAGEMENT TESTS
    // ========================================
    describe('D. Likes & Engagement', () => {
      it('should have 18 likes on posts', async () => {
        const likesOnPosts = await graph.getEdgesByType('LIKES_POST');
        expect(likesOnPosts).toHaveLength(18);
      });

      it('should have 9 likes on photos', async () => {
        const likesOnPhotos = await graph.getEdgesByType('LIKES_PHOTO');
        expect(likesOnPhotos).toHaveLength(9);
      });

      it('should find most liked post (Hello World with 4)', async () => {
        const allPosts = await graph.getNodesByType('Post');
        let maxLikes = 0;
        let mostLikedPost = '';

        for (const post of allPosts) {
          const likes = await graph.getEdgesTo(post.id, { filter: { edgeType: 'LIKES_POST' } });
          if (likes.length > maxLikes) {
            maxLikes = likes.length;
            mostLikedPost = post.properties.content as string;
          }
        }

        expect(mostLikedPost).toContain('Just joined');
        expect(maxLikes).toBe(4);
      });

      it('should find person who liked most posts', async () => {
        const allPeople = await graph.getNodesByType('Person');
        let maxLikes = 0;

        for (const person of allPeople) {
          const likes = await graph.getEdgesFrom(person.id, { filter: { edgeType: 'LIKES_POST' } });
          if (likes.length > maxLikes) {
            maxLikes = likes.length;
          }
        }

        expect(maxLikes).toBeGreaterThanOrEqual(3);
      });
    });

    // ========================================
    // E. COMMENTS TESTS
    // ========================================
    describe('E. Comments', () => {
      it('should have 12 commented on post edges', async () => {
        const commentPostEdges = await graph.getEdgesByType('COMMENTED_ON_POST');
        expect(commentPostEdges).toHaveLength(12);
      });

      it('should have 12 on post edges', async () => {
        const onPostEdges = await graph.getEdgesByType('ON_POST');
        expect(onPostEdges).toHaveLength(12);
      });

      it('should have 8 commented on photo edges', async () => {
        const commentPhotoEdges = await graph.getEdgesByType('COMMENTED_ON_PHOTO');
        expect(commentPhotoEdges).toHaveLength(8);
      });

      it('should have 8 on photo edges', async () => {
        const onPhotoEdges = await graph.getEdgesByType('ON_PHOTO');
        expect(onPhotoEdges).toHaveLength(8);
      });

      it('should find most commented post has 3 comments', async () => {
        const allPosts = await graph.getNodesByType('Post');
        let maxComments = 0;

        for (const post of allPosts) {
          const commentsOnPost = await graph.getParents(post.id, { filter: { edgeType: 'ON_POST' } });
          if (commentsOnPost.length > maxComments) {
            maxComments = commentsOnPost.length;
          }
        }

        expect(maxComments).toBe(3);
      });
    });

    // ========================================
    // F. COMPLEX TRAVERSAL QUERY TESTS
    // ========================================
    describe('F. Complex Traversal Queries', () => {
      it('should find path from Alice to David via friends (Alice -> Bob -> David)', async () => {
        const allPeople = await graph.getNodesByType('Person');
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const david = allPeople.find(n => n.properties.name === 'David')!;

        const paths = await graph.traverse(alice.id, david.id, {
          method: 'bfs',
          edgeTypes: ['FRIENDS_WITH']
        });

        expect(paths).not.toBeNull();
        if (paths) {
          expect(paths.length).toBeGreaterThan(0);
          expect(paths[0]).toContain(alice.id);
          expect(paths[0]).toContain(david.id);
        }
      });

      it('should find all people who liked Alice posts', async () => {
        const allPeople = await graph.getNodesByType('Person');
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const alicePosts = await graph.getChildren(alice.id, { filter: { edgeType: 'POSTED' } });
        const likerNames = new Set<string>();

        for (const post of alicePosts) {
          const likes = await graph.getEdgesTo(post.id, { filter: { edgeType: 'LIKES_POST' } });
          for (const like of likes) {
            const liker = await graph.getNode(like.sourceId);
            likerNames.add(liker!.properties.name as string);
          }
        }

        expect(likerNames.size).toBeGreaterThanOrEqual(3);
      });

      it('should find mutual friends between Alice and Frank', async () => {
        const allPeople = await graph.getNodesByType('Person');
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const frank = allPeople.find(n => n.properties.name === 'Frank')!;

        const aliceFriends = await graph.getChildren(alice.id, { filter: { edgeType: 'FRIENDS_WITH' } });
        const frankFriends = await graph.getChildren(frank.id, { filter: { edgeType: 'FRIENDS_WITH' } });

        const aliceFriendIds = new Set(aliceFriends.map(n => n.id));
        const mutualFriends = frankFriends.filter(n => aliceFriendIds.has(n.id));
        const mutualNames = mutualFriends.map(n => n.properties.name);

        expect(mutualNames).toContain('Charlie');
        expect(mutualNames).toContain('Eve');
        expect(mutualNames).toHaveLength(2);
      });
    });

    // ========================================
    // G. SERIALIZATION ROUND-TRIP TESTS
    // ========================================
    describe('G. Serialization Round-trip', () => {
      it('should serialize graph to JSON correctly', async () => {
        const json = await graph.exportJSON();

        expect(json.nodes).toBeDefined();
        expect(json.edges).toBeDefined();
        expect(json.nodes).toHaveLength(42);
        expect(json.edges.length).toBeGreaterThan(60);
      });

      it('should preserve all node types during serialization', async () => {
        const json = await graph.exportJSON();

        const personNodes = json.nodes.filter(n => n.type === 'Person');
        const postNodes = json.nodes.filter(n => n.type === 'Post');
        const photoNodes = json.nodes.filter(n => n.type === 'Photo');
        const commentNodes = json.nodes.filter(n => n.type === 'Comment');

        expect(personNodes).toHaveLength(10);
        expect(postNodes).toHaveLength(7);
        expect(photoNodes).toHaveLength(5);
        expect(commentNodes).toHaveLength(20);
      });

      it('should reconstruct graph from JSON with all nodes intact', async () => {
        const json = await graph.exportJSON();
        const reconstructed = await Graph.importJSON(json);

        const allNodes = await reconstructed.getNodes();
        const allEdges = await reconstructed.getEdges();
        expect(allNodes).toHaveLength(42);
        expect(allEdges.length).toBeGreaterThan(60);
      });

      it('should preserve relationships after serialization', async () => {
        const json = await graph.exportJSON();
        const reconstructed = await Graph.importJSON(json);

        const allNodes = await reconstructed.getNodes();
        const aliceNode = allNodes.find(n => n.properties.name === 'Alice');
        expect(aliceNode).toBeDefined();

        const aliceFriends = await reconstructed.getChildren(aliceNode!.id, { filter: { edgeType: 'FRIENDS_WITH' } });
        expect(aliceFriends.length).toBe(4);
      });

      it('should preserve node properties after serialization', async () => {
        const json = await graph.exportJSON();
        const reconstructed = await Graph.importJSON(json);

        const allNodes = await reconstructed.getNodes();
        const charlieNode = allNodes.find(n => n.properties.name === 'Charlie');
        expect(charlieNode?.properties.age).toBe(32);
        expect(charlieNode?.properties.city).toBe('Chicago');
        expect(charlieNode?.properties.occupation).toBe('Manager');
      });

      it('should preserve edge properties after serialization', async () => {
        const json = await graph.exportJSON();
        const reconstructed = await Graph.importJSON(json);

        const friendshipEdges = await reconstructed.getEdgesByType('FRIENDS_WITH');
        const aliceBobEdge = await Promise.all(
          friendshipEdges.map(async e => {
            const source = await reconstructed.getNode(e.sourceId);
            const target = await reconstructed.getNode(e.targetId);
            return { edge: e, source, target };
          })
        ).then(results => results.find(r =>
          r.source?.properties.name === 'Alice' && r.target?.properties.name === 'Bob'
        ));

        expect(aliceBobEdge?.edge.properties.since).toBe(2020);
        expect(aliceBobEdge?.edge.properties.context).toBe('college');
      });

      it('should handle empty graph serialization', async () => {
        const emptyGraph = new Graph();
        const json = await emptyGraph.exportJSON();

        expect(json.nodes).toHaveLength(0);
        expect(json.edges).toHaveLength(0);

        const reconstructed = await Graph.importJSON(json);
        const allNodes = await reconstructed.getNodes();
        expect(allNodes).toHaveLength(0);
      });
    });

    // ========================================
    // H. EDGE CASES AND ERROR HANDLING
    // ========================================
    describe('H. Edge Cases', () => {
      it('should return undefined for non-existent node', async () => {
        const node = await graph.getNode('non-existent-id');
        expect(node).toBeUndefined();
      });

      it('should return undefined for non-existent edge', async () => {
        const edge = await graph.getEdge('non-existent-edge-id');
        expect(edge).toBeUndefined();
      });

      it('should find node by property value', async () => {
        const results = await graph.getNodesByProperty('name', 'Grace');
        expect(results).toHaveLength(1);
        expect(results[0].properties.city).toBe('Denver');
      });

      it('should find nodes by type with multiple results', async () => {
        const allPersons = await graph.getNodesByType('Person');
        expect(allPersons.length).toBe(10);
      });

      it('should return empty for getNodesByProperty with no matches', async () => {
        const results = await graph.getNodesByProperty('name', 'NonExistent');
        expect(results).toHaveLength(0);
      });

      it('should filter edges by type correctly', async () => {
        const allEdges = await graph.getEdges();
        const friendships = await graph.getEdgesByType('FRIENDS_WITH');
        const likesPost = await graph.getEdgesByType('LIKES_POST');

        expect(allEdges.length).toBeGreaterThan(friendships.length);
        expect(friendships).toHaveLength(28);
        expect(likesPost).toHaveLength(18);
      });
    });

    // ========================================
    // I. GRAPH ALGORITHM TESTS
    // ========================================
    describe('I. Graph Algorithm Tests', () => {
      it('should run isDAG and get valid boolean result', async () => {
        const isDAG = await graph.isDAG();
        expect(typeof isDAG).toBe('boolean');
      });

      it('should find paths from one person to another when path exists', async () => {
        const allPeople = await graph.getNodesByType('Person');
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const bob = allPeople.find(n => n.properties.name === 'Bob')!;

        const paths = await graph.traverse(alice.id, bob.id, { method: 'bfs' });
        expect(paths).not.toBeNull();
        expect(paths!.length).toBeGreaterThan(0);
      });

      it('should handle edge type filtering in traversal', async () => {
        const allPeople = await graph.getNodesByType('Person');
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const bob = allPeople.find(n => n.properties.name === 'Bob')!;

        const paths = await graph.traverse(alice.id, bob.id, {
          method: 'bfs',
          edgeTypes: ['FRIENDS_WITH']
        });

        expect(paths).not.toBeNull();
      });
    });

    // ========================================
    // J. CLEAR OPERATION (must be last)
    // ========================================
    describe('J. Node and Edge Removal Operations', () => {
      it('should return false when removing non-existent node', async () => {
        await expect(graph.removeNode('fake-id')).resolves.toBe(false);
      });

      it('should return false when removing non-existent edge', async () => {
        await expect(graph.removeEdge('fake-edge-id')).resolves.toBe(false);
      });

      it('should remove an edge and verify it is deleted', async () => {
        const initialEdges = await graph.getEdges();
        const initialEdgeCount = initialEdges.length;

        const friendshipEdges = await graph.getEdgesByType('FRIENDS_WITH');
        const friendshipEdge = friendshipEdges[0];
        expect(friendshipEdge).toBeDefined();

        const result = await graph.removeEdge(friendshipEdge.id);
        expect(result).toBe(true);

        expect(await graph.getEdge(friendshipEdge.id)).toBeUndefined();
        const afterEdges = await graph.getEdges();
        expect(afterEdges.length).toBe(initialEdgeCount - 1);
      });

      it('should remove a node with cascade (remove all incident edges)', async () => {
        const initialNodes = await graph.getNodes();
        const initialNodeCount = initialNodes.length;
        const initialEdges = await graph.getEdges();
        const initialEdgeCount = initialEdges.length;

        const alice = initialNodes.find(n => n.properties.name === 'Alice');
        expect(alice).toBeDefined();

        const aliceOutgoingEdges = await graph.getEdgesFrom(alice!.id);
        const aliceIncomingEdges = await graph.getEdgesTo(alice!.id);
        const aliceTotalEdges = aliceOutgoingEdges.length + aliceIncomingEdges.length;

        const result = await graph.removeNode(alice!.id, true);
        expect(result).toBe(true);

        expect(await graph.getNode(alice!.id)).toBeUndefined();

        const afterNodes = await graph.getNodes();
        expect(afterNodes.length).toBe(initialNodeCount - 1);

        const afterEdges = await graph.getEdges();
        expect(afterEdges.length).toBe(initialEdgeCount - aliceTotalEdges);
      });

      it('should clear graph completely', async () => {
        await graph.clear();
        const allNodes = await graph.getNodes();
        const allEdges = await graph.getEdges();
        expect(allNodes).toHaveLength(0);
        expect(allEdges).toHaveLength(0);
      });
    });
  });
}
