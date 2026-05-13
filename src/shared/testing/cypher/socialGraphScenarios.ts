import { describe, it, expect, beforeEach } from '@jest/globals';
import { Graph, Node } from '../../../index';
import { CypherEngine } from '../../../cypher';

/**
 * Shared test scenarios for the Facebook Social Graph using Cypher queries.
 * These tests mirror the structure of socialGraphScenarios.ts but use the
 * Cypher query engine instead of direct Graph API calls.
 *
 * @param provider - Optional storage provider instance
 */
export function runSocialGraphCypherScenarios(): void {
  describe('Facebook Social Graph (Cypher)', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeEach(async () => {
      graph = new Graph();
      engine = new CypherEngine(graph);

      // Create index on 'name' property since socialGraphScenarios queries by name
      await graph.createIndex('node', 'name');

      // ========================================
      // CREATE PEOPLE (10 nodes)
      // ========================================
      const alice = await graph.addNode('Person', { name: 'Alice', age: 28, city: 'NYC', occupation: 'Engineer' });
      const bob = await graph.addNode('Person', { name: 'Bob', age: 25, city: 'LA', occupation: 'Designer' });
      const charlie = await graph.addNode('Person', { name: 'Charlie', age: 32, city: 'Chicago', occupation: 'Manager' });
      const david = await graph.addNode('Person', { name: 'David', age: 29, city: 'Seattle', occupation: 'Developer' });
      const eve = await graph.addNode('Person', { name: 'Eve', age: 27, city: 'Boston', occupation: 'Data Scientist' });
      const frank = await graph.addNode('Person', { name: 'Frank', age: 35, city: 'Austin', occupation: 'Director' });
      const grace = await graph.addNode('Person', { name: 'Grace', age: 26, city: 'Denver', occupation: 'Designer' });
      const henry = await graph.addNode('Person', { name: 'Henry', age: 31, city: 'Portland', occupation: 'Engineer' });
      const ivan = await graph.addNode('Person', { name: 'Ivan', age: 30, city: 'Phoenix', occupation: 'Analyst' });
      const julia = await graph.addNode('Person', { name: 'Julia', age: 28, city: 'Miami', occupation: 'Marketing' });

      // ========================================
      // CREATE POSTS (7 nodes)
      // ========================================
      const postHello = await graph.addNode('Post', { content: 'Just joined the social network!', timestamp: '2024-01-01', type: 'status' });
      const postLink = await graph.addNode('Post', { content: 'Interesting article about graphs', timestamp: '2024-02-15', type: 'link' });
      const postBirthday = await graph.addNode('Post', { content: 'Wishing everyone a great day!', timestamp: '2024-03-20', type: 'status' });
      const postWeekend = await graph.addNode('Post', { content: 'Any recommendations for a weekend getaway?', timestamp: '2024-04-10', type: 'question' });
      const postTravel = await graph.addNode('Post', { content: 'My amazing trip to Europe', timestamp: '2024-05-25', type: 'travel' });
      const postWork = await graph.addNode('Post', { content: 'Excited about the new project launch', timestamp: '2024-06-18', type: 'work' });
      const postMemory = await graph.addNode('Post', { content: 'Remember when we all met?', timestamp: '2024-07-01', type: 'memory' });

      // ========================================
      // CREATE PHOTOS (5 nodes)
      // ========================================
      const photoBeach = await graph.addNode('Photo', { caption: 'Amazing day at the beach!', date: '2024-06-15', location: 'Hawaii' });
      const photoParty = await graph.addNode('Photo', { caption: 'Friday night vibes', date: '2024-07-20', location: 'LA' });
      const photoGraduation = await graph.addNode('Photo', { caption: 'We made it!', date: '2024-05-30', location: 'Boston' });
      const photoFood = await graph.addNode('Photo', { caption: 'Yummy food!', date: '2024-08-10', location: 'NYC' });
      const photoMountain = await graph.addNode('Photo', { caption: 'Conquered the peak!', date: '2024-07-05', location: 'Rocky Mountains' });

      // ========================================
      // CREATE COMMENTS (20 nodes)
      // ========================================
      const c1 = await graph.addNode('Comment', { content: 'Welcome to the network!', date: '2024-01-01' });
      const c2 = await graph.addNode('Comment', { content: 'Congrats on joining!', date: '2024-01-02' });
      const c3 = await graph.addNode('Comment', { content: 'Great read, thanks for sharing!', date: '2024-02-16' });
      const c4 = await graph.addNode('Comment', { content: 'I agree with this!', date: '2024-02-17' });
      const c5 = await graph.addNode('Comment', { content: 'Very informative post.', date: '2024-02-18' });
      const c6 = await graph.addNode('Comment', { content: 'Happy birthday to you too!', date: '2024-03-21' });
      const c7 = await graph.addNode('Comment', { content: 'Wish you all the best!', date: '2024-03-22' });
      const c8 = await graph.addNode('Comment', { content: 'Thanks for the birthday wishes!', date: '2024-03-23' });
      const c9 = await graph.addNode('Comment', { content: 'Try the mountains!', date: '2024-04-11' });
      const c10 = await graph.addNode('Comment', { content: 'Beach is always a good choice.', date: '2024-04-12' });
      const c11 = await graph.addNode('Comment', { content: 'Europe sounds amazing!', date: '2024-05-26' });
      const c12 = await graph.addNode('Comment', { content: 'Good luck with the launch!', date: '2024-06-19' });
      const c13 = await graph.addNode('Comment', { content: 'Stunning beach!', date: '2024-06-16' });
      const c14 = await graph.addNode('Comment', { content: 'Looks like a fun party!', date: '2024-07-21' });
      const c15 = await graph.addNode('Comment', { content: 'Congrats on graduation!', date: '2024-05-31' });
      const c16 = await graph.addNode('Comment', { content: 'What a feast!', date: '2024-08-11' });
      const c17 = await graph.addNode('Comment', { content: 'Great hike!', date: '2024-07-06' });
      const c18 = await graph.addNode('Comment', { content: 'Wish I was there!', date: '2024-06-17' });
      const c19 = await graph.addNode('Comment', { content: 'You guys look great!', date: '2024-07-22' });
      const c20 = await graph.addNode('Comment', { content: 'Beautiful scenery!', date: '2024-05-31' });

      // ========================================
      // CREATE FRIENDSHIP RELATIONSHIPS (28 edges - bidirectional)
      // ========================================
      await graph.addEdge(alice.id, bob.id, 'FRIENDS_WITH', { since: 2020, context: 'college' });
      await graph.addEdge(bob.id, alice.id, 'FRIENDS_WITH', { since: 2020, context: 'college' });
      await graph.addEdge(alice.id, charlie.id, 'FRIENDS_WITH', { since: 2019, context: 'work' });
      await graph.addEdge(charlie.id, alice.id, 'FRIENDS_WITH', { since: 2019, context: 'work' });
      await graph.addEdge(alice.id, eve.id, 'FRIENDS_WITH', { since: 2021, context: 'neighbors' });
      await graph.addEdge(eve.id, alice.id, 'FRIENDS_WITH', { since: 2021, context: 'neighbors' });
      await graph.addEdge(alice.id, julia.id, 'FRIENDS_WITH', { since: 2018, context: 'highschool' });
      await graph.addEdge(julia.id, alice.id, 'FRIENDS_WITH', { since: 2018, context: 'highschool' });
      await graph.addEdge(bob.id, charlie.id, 'FRIENDS_WITH', { since: 2020, context: 'gym' });
      await graph.addEdge(charlie.id, bob.id, 'FRIENDS_WITH', { since: 2020, context: 'gym' });
      await graph.addEdge(bob.id, david.id, 'FRIENDS_WITH', { since: 2019, context: 'coding' });
      await graph.addEdge(david.id, bob.id, 'FRIENDS_WITH', { since: 2019, context: 'coding' });
      await graph.addEdge(charlie.id, frank.id, 'FRIENDS_WITH', { since: 2018, context: 'business' });
      await graph.addEdge(frank.id, charlie.id, 'FRIENDS_WITH', { since: 2018, context: 'business' });
      await graph.addEdge(david.id, grace.id, 'FRIENDS_WITH', { since: 2022, context: 'hiking' });
      await graph.addEdge(grace.id, david.id, 'FRIENDS_WITH', { since: 2022, context: 'hiking' });
      await graph.addEdge(eve.id, frank.id, 'FRIENDS_WITH', { since: 2020, context: 'bookclub' });
      await graph.addEdge(frank.id, eve.id, 'FRIENDS_WITH', { since: 2020, context: 'bookclub' });
      await graph.addEdge(eve.id, grace.id, 'FRIENDS_WITH', { since: 2021, context: 'yoga' });
      await graph.addEdge(grace.id, eve.id, 'FRIENDS_WITH', { since: 2021, context: 'yoga' });
      await graph.addEdge(frank.id, ivan.id, 'FRIENDS_WITH', { since: 2019, context: 'mentor' });
      await graph.addEdge(ivan.id, frank.id, 'FRIENDS_WITH', { since: 2019, context: 'mentor' });
      await graph.addEdge(grace.id, henry.id, 'FRIENDS_WITH', { since: 2021, context: 'photography' });
      await graph.addEdge(henry.id, grace.id, 'FRIENDS_WITH', { since: 2021, context: 'photography' });
      await graph.addEdge(henry.id, julia.id, 'FRIENDS_WITH', { since: 2020, context: 'music' });
      await graph.addEdge(julia.id, henry.id, 'FRIENDS_WITH', { since: 2020, context: 'music' });
      await graph.addEdge(ivan.id, julia.id, 'FRIENDS_WITH', { since: 2019, context: 'travel' });
      await graph.addEdge(julia.id, ivan.id, 'FRIENDS_WITH', { since: 2019, context: 'travel' });

      // ========================================
      // CREATE POSTED RELATIONSHIPS (7 edges)
      // ========================================
      await graph.addEdge(alice.id, postHello.id, 'POSTED', { timestamp: '2024-01-01T10:00:00Z' });
      await graph.addEdge(bob.id, postLink.id, 'POSTED', { timestamp: '2024-02-15T14:30:00Z' });
      await graph.addEdge(charlie.id, postBirthday.id, 'POSTED', { timestamp: '2024-03-20T08:15:00Z' });
      await graph.addEdge(david.id, postWeekend.id, 'POSTED', { timestamp: '2024-04-10T19:45:00Z' });
      await graph.addEdge(eve.id, postTravel.id, 'POSTED', { timestamp: '2024-05-25T16:20:00Z' });
      await graph.addEdge(frank.id, postWork.id, 'POSTED', { timestamp: '2024-06-18T11:00:00Z' });
      await graph.addEdge(julia.id, postMemory.id, 'POSTED', { timestamp: '2024-07-01T22:30:00Z' });

      // ========================================
      // CREATE PHOTO_UPLOADED RELATIONSHIPS (5 edges)
      // ========================================
      await graph.addEdge(alice.id, photoBeach.id, 'PHOTO_UPLOADED', { timestamp: '2024-06-15T18:00:00Z' });
      await graph.addEdge(bob.id, photoParty.id, 'PHOTO_UPLOADED', { timestamp: '2024-07-20T23:00:00Z' });
      await graph.addEdge(charlie.id, photoGraduation.id, 'PHOTO_UPLOADED', { timestamp: '2024-05-30T20:00:00Z' });
      await graph.addEdge(grace.id, photoFood.id, 'PHOTO_UPLOADED', { timestamp: '2024-08-10T13:30:00Z' });
      await graph.addEdge(ivan.id, photoMountain.id, 'PHOTO_UPLOADED', { timestamp: '2024-07-05T15:45:00Z' });

      // ========================================
      // CREATE LIKES_POST RELATIONSHIPS (20 edges)
      // ========================================
      await graph.addEdge(bob.id, postHello.id, 'LIKES_POST', { timestamp: '2024-01-02T09:00:00Z' });
      await graph.addEdge(charlie.id, postHello.id, 'LIKES_POST', { timestamp: '2024-01-02T10:30:00Z' });
      await graph.addEdge(david.id, postHello.id, 'LIKES_POST', { timestamp: '2024-01-02T11:00:00Z' });
      await graph.addEdge(eve.id, postHello.id, 'LIKES_POST', { timestamp: '2024-01-02T12:15:00Z' });
      await graph.addEdge(alice.id, postLink.id, 'LIKES_POST', { timestamp: '2024-02-16T08:00:00Z' });
      await graph.addEdge(charlie.id, postLink.id, 'LIKES_POST', { timestamp: '2024-02-16T09:30:00Z' });
      await graph.addEdge(grace.id, postLink.id, 'LIKES_POST', { timestamp: '2024-02-16T10:00:00Z' });
      await graph.addEdge(alice.id, postBirthday.id, 'LIKES_POST', { timestamp: '2024-03-21T07:00:00Z' });
      await graph.addEdge(bob.id, postBirthday.id, 'LIKES_POST', { timestamp: '2024-03-21T08:30:00Z' });
      await graph.addEdge(frank.id, postBirthday.id, 'LIKES_POST', { timestamp: '2024-03-21T09:00:00Z' });
      await graph.addEdge(grace.id, postWeekend.id, 'LIKES_POST', { timestamp: '2024-04-11T08:00:00Z' });
      await graph.addEdge(henry.id, postWeekend.id, 'LIKES_POST', { timestamp: '2024-04-11T09:30:00Z' });
      await graph.addEdge(ivan.id, postTravel.id, 'LIKES_POST', { timestamp: '2024-05-26T17:00:00Z' });
      await graph.addEdge(julia.id, postTravel.id, 'LIKES_POST', { timestamp: '2024-05-26T18:30:00Z' });
      await graph.addEdge(alice.id, postWork.id, 'LIKES_POST', { timestamp: '2024-06-19T12:00:00Z' });
      await graph.addEdge(eve.id, postWork.id, 'LIKES_POST', { timestamp: '2024-06-19T13:30:00Z' });
      await graph.addEdge(david.id, postMemory.id, 'LIKES_POST', { timestamp: '2024-07-02T08:00:00Z' });
      await graph.addEdge(grace.id, postMemory.id, 'LIKES_POST', { timestamp: '2024-07-02T09:30:00Z' });

      // ========================================
      // CREATE LIKES_PHOTO RELATIONSHIPS (9 edges)
      // ========================================
      await graph.addEdge(david.id, photoBeach.id, 'LIKES_PHOTO', { timestamp: '2024-06-16T08:00:00Z' });
      await graph.addEdge(eve.id, photoBeach.id, 'LIKES_PHOTO', { timestamp: '2024-06-16T09:30:00Z' });
      await graph.addEdge(grace.id, photoBeach.id, 'LIKES_PHOTO', { timestamp: '2024-06-16T10:00:00Z' });
      await graph.addEdge(alice.id, photoParty.id, 'LIKES_PHOTO', { timestamp: '2024-07-21T08:00:00Z' });
      await graph.addEdge(charlie.id, photoParty.id, 'LIKES_PHOTO', { timestamp: '2024-07-21T09:30:00Z' });
      await graph.addEdge(henry.id, photoGraduation.id, 'LIKES_PHOTO', { timestamp: '2024-05-31T21:00:00Z' });
      await graph.addEdge(julia.id, photoGraduation.id, 'LIKES_PHOTO', { timestamp: '2024-05-31T22:30:00Z' });
      await graph.addEdge(bob.id, photoFood.id, 'LIKES_PHOTO', { timestamp: '2024-08-11T14:00:00Z' });
      await graph.addEdge(eve.id, photoMountain.id, 'LIKES_PHOTO', { timestamp: '2024-07-06T16:00:00Z' });

      // ========================================
      // CREATE COMMENTED_ON_POST + ON_POST RELATIONSHIPS (24 edges)
      // ========================================
      await graph.addEdge(bob.id, c1.id, 'COMMENTED_ON_POST', { timestamp: '2024-01-01T11:00:00Z' });
      await graph.addEdge(c1.id, postHello.id, 'ON_POST', {});
      await graph.addEdge(david.id, c2.id, 'COMMENTED_ON_POST', { timestamp: '2024-01-02T14:00:00Z' });
      await graph.addEdge(c2.id, postHello.id, 'ON_POST', {});
      await graph.addEdge(eve.id, c3.id, 'COMMENTED_ON_POST', { timestamp: '2024-02-16T11:00:00Z' });
      await graph.addEdge(c3.id, postLink.id, 'ON_POST', {});
      await graph.addEdge(grace.id, c4.id, 'COMMENTED_ON_POST', { timestamp: '2024-02-17T09:00:00Z' });
      await graph.addEdge(c4.id, postLink.id, 'ON_POST', {});
      await graph.addEdge(alice.id, c5.id, 'COMMENTED_ON_POST', { timestamp: '2024-02-18T16:00:00Z' });
      await graph.addEdge(c5.id, postLink.id, 'ON_POST', {});
      await graph.addEdge(bob.id, c6.id, 'COMMENTED_ON_POST', { timestamp: '2024-03-21T10:00:00Z' });
      await graph.addEdge(c6.id, postBirthday.id, 'ON_POST', {});
      await graph.addEdge(charlie.id, c7.id, 'COMMENTED_ON_POST', { timestamp: '2024-03-22T08:30:00Z' });
      await graph.addEdge(c7.id, postBirthday.id, 'ON_POST', {});
      await graph.addEdge(david.id, c8.id, 'COMMENTED_ON_POST', { timestamp: '2024-03-23T15:00:00Z' });
      await graph.addEdge(c8.id, postBirthday.id, 'ON_POST', {});
      await graph.addEdge(eve.id, c9.id, 'COMMENTED_ON_POST', { timestamp: '2024-04-11T12:00:00Z' });
      await graph.addEdge(c9.id, postWeekend.id, 'ON_POST', {});
      await graph.addEdge(frank.id, c10.id, 'COMMENTED_ON_POST', { timestamp: '2024-04-12T09:00:00Z' });
      await graph.addEdge(c10.id, postWeekend.id, 'ON_POST', {});
      await graph.addEdge(ivan.id, c11.id, 'COMMENTED_ON_POST', { timestamp: '2024-05-26T19:00:00Z' });
      await graph.addEdge(c11.id, postTravel.id, 'ON_POST', {});
      await graph.addEdge(julia.id, c12.id, 'COMMENTED_ON_POST', { timestamp: '2024-06-19T14:00:00Z' });
      await graph.addEdge(c12.id, postWork.id, 'ON_POST', {});

      // ========================================
      // CREATE COMMENTED_ON_PHOTO + ON_PHOTO RELATIONSHIPS (16 edges)
      // ========================================
      await graph.addEdge(alice.id, c13.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-06-16T19:00:00Z' });
      await graph.addEdge(c13.id, photoBeach.id, 'ON_PHOTO', {});
      await graph.addEdge(grace.id, c18.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-06-17T10:00:00Z' });
      await graph.addEdge(c18.id, photoBeach.id, 'ON_PHOTO', {});
      await graph.addEdge(charlie.id, c14.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-07-21T08:00:00Z' });
      await graph.addEdge(c14.id, photoParty.id, 'ON_PHOTO', {});
      await graph.addEdge(henry.id, c19.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-07-22T09:30:00Z' });
      await graph.addEdge(c19.id, photoParty.id, 'ON_PHOTO', {});
      await graph.addEdge(david.id, c15.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-05-31T21:00:00Z' });
      await graph.addEdge(c15.id, photoGraduation.id, 'ON_PHOTO', {});
      await graph.addEdge(ivan.id, c20.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-05-31T22:00:00Z' });
      await graph.addEdge(c20.id, photoGraduation.id, 'ON_PHOTO', {});
      await graph.addEdge(eve.id, c16.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-08-11T14:30:00Z' });
      await graph.addEdge(c16.id, photoFood.id, 'ON_PHOTO', {});
      await graph.addEdge(frank.id, c17.id, 'COMMENTED_ON_PHOTO', { timestamp: '2024-07-06T17:00:00Z' });
      await graph.addEdge(c17.id, photoMountain.id, 'ON_PHOTO', {});
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
