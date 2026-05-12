import { afterAll, beforeAll, beforeEach, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider, Node } from '../../index';

/**
 * Shared test scenarios for the Facebook Social Graph.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param provider - Storage provider instance
 */
export function runSocialGraphScenarios(provider?: IStorageProvider): void {
  describe('Facebook Social Graph', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
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
        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(42);
      });

      it('should have exactly 10 people', async () => {
        const peopleNodes = await graph.getNodes({ filter: { types: ['Person'] } });
        expect(peopleNodes).toHaveLength(10);
      });

      it('should have exactly 7 posts', async () => {
        const postNodes = await graph.getNodes({ filter: { types: ['Post'] } });
        expect(postNodes).toHaveLength(7);
      });

      it('should have exactly 5 photos', async () => {
        const photoNodes = await graph.getNodes({ filter: { types: ['Photo'] } });
        expect(photoNodes).toHaveLength(5);
      });

      it('should have exactly 20 comments', async () => {
        const commentNodes = await graph.getNodes({ filter: { types: ['Comment'] } });
        expect(commentNodes).toHaveLength(20);
      });

      it('should have all 10 people with correct names', async () => {
        const peopleNodes = await graph.getNodes({ filter: { types: ['Person'] } });
        const names = peopleNodes.map((n: any) => n.properties.name as string).sort();
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
        const friendships = await graph.getEdges({ filter: { types: ['FRIENDS_WITH'] } });
        expect(friendships).toHaveLength(28);
      });

      it('should find the most social person (most friendships)', async () => {
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
        let maxFriends = 0;
        let mostSocial = '';

        for (const person of allPeople) {
          const friendEdges = await graph.getEdgesFrom(person.id, { filter: { types: ['FRIENDS_WITH'] } });
          const friends = await Promise.all(friendEdges.map(e => graph.getNode(e.targetId)));
          const friendList = friends.filter((n): n is Node => n !== undefined);
          if (friendList.length > maxFriends) {
            maxFriends = friendList.length;
            mostSocial = person.properties.name as string;
          }
        }

        expect(mostSocial).toBe('Alice');
        expect(maxFriends).toBe(4);
      });

      it('should get friends of friends for Alice (2nd degree connections)', async () => {
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
        const alice = allPeople.find((n: any) => n.properties.name === 'Alice')!;
        const aliceFriendEdges = await graph.getEdgesFrom(alice.id, { filter: { types: ['FRIENDS_WITH'] } });
        const aliceFriends = await Promise.all(aliceFriendEdges.map(e => graph.getNode(e.targetId)));
        const aliceFriendList = aliceFriends.filter((n): n is Node => n !== undefined);
        const friendsOfFriends = new Set<string>();

        for (const friend of aliceFriendList) {
          const theirFriendEdges = await graph.getEdgesFrom(friend.id, { filter: { types: ['FRIENDS_WITH'] } });
          const theirFriends = await Promise.all(theirFriendEdges.map(e => graph.getNode(e.targetId)));
          const theirFriendList = theirFriends.filter((n): n is Node => n !== undefined);
          for (const fof of theirFriendList) {
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
        const postedEdges = await graph.getEdges({ filter: { types: ['POSTED'] } });
        expect(postedEdges).toHaveLength(7);
      });

      it('should have 5 photo uploaded edges', async () => {
        const uploadedEdges = await graph.getEdges({ filter: { types: ['PHOTO_UPLOADED'] } });
        expect(uploadedEdges).toHaveLength(5);
      });

      it('should find all posts by Alice', async () => {
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
        const alice = allPeople.find((n: any) => n.properties.name === 'Alice')!;
        const alicePostEdges = await graph.getEdgesFrom(alice.id, { filter: { types: ['POSTED'] } });
        const alicePosts = await Promise.all(alicePostEdges.map(e => graph.getNode(e.targetId)));
        const postList = alicePosts.filter((n): n is Node => n !== undefined);
        expect(postList).toHaveLength(1);
        expect(postList[0].properties.content).toContain('Just joined');
      });
    });

    // ========================================
    // D. LIKES & ENGAGEMENT TESTS
    // ========================================
    describe('D. Likes & Engagement', () => {
      it('should have 18 likes on posts', async () => {
        const likesOnPosts = await graph.getEdges({ filter: { types: ['LIKES_POST'] } });
        expect(likesOnPosts).toHaveLength(18);
      });

      it('should have 9 likes on photos', async () => {
        const likesOnPhotos = await graph.getEdges({ filter: { types: ['LIKES_PHOTO'] } });
        expect(likesOnPhotos).toHaveLength(9);
      });

      it('should find most liked post (Hello World with 4)', async () => {
        const allPosts = await graph.getNodes({ filter: { types: ['Post'] } });
        let maxLikes = 0;
        let mostLikedPost = '';

        for (const post of allPosts) {
          const likes = await graph.getEdgesTo(post.id, { filter: { types: ['LIKES_POST'] } });
          if (likes.length > maxLikes) {
            maxLikes = likes.length;
            mostLikedPost = post.properties.content as string;
          }
        }

        expect(mostLikedPost).toContain('Just joined');
        expect(maxLikes).toBe(4);
      });

      it('should find person who liked most posts', async () => {
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
        let maxLikes = 0;

        for (const person of allPeople) {
          const likes = await graph.getEdgesFrom(person.id, { filter: { types: ['LIKES_POST'] } });
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
        const commentPostEdges = await graph.getEdges({ filter: { types: ['COMMENTED_ON_POST'] } });
        expect(commentPostEdges).toHaveLength(12);
      });

      it('should have 12 on post edges', async () => {
        const onPostEdges = await graph.getEdges({ filter: { types: ['ON_POST'] } });
        expect(onPostEdges).toHaveLength(12);
      });

      it('should have 8 commented on photo edges', async () => {
        const commentPhotoEdges = await graph.getEdges({ filter: { types: ['COMMENTED_ON_PHOTO'] } });
        expect(commentPhotoEdges).toHaveLength(8);
      });

      it('should have 8 on photo edges', async () => {
        const onPhotoEdges = await graph.getEdges({ filter: { types: ['ON_PHOTO'] } });
        expect(onPhotoEdges).toHaveLength(8);
      });

      it('should find most commented post has 3 comments', async () => {
        const allPosts = await graph.getNodes({ filter: { types: ['Post'] } });
        let maxComments = 0;

        for (const post of allPosts) {
          const commentEdges = await graph.getEdgesTo(post.id, { filter: { types: ['ON_POST'] } });
          if (commentEdges.length > maxComments) {
            maxComments = commentEdges.length;
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
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
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
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const alicePostEdges = await graph.getEdgesFrom(alice.id, { filter: { types: ['POSTED'] } });
        const alicePosts = await Promise.all(alicePostEdges.map(e => graph.getNode(e.targetId)));
        const postList = alicePosts.filter((n): n is Node => n !== undefined);
        const likerNames = new Set<string>();

        for (const post of postList) {
          const likes = await graph.getEdgesTo(post.id, { filter: { types: ['LIKES_POST'] } });
          for (const like of likes) {
            const liker = await graph.getNode(like.sourceId);
            if (liker) likerNames.add(liker.properties.name as string);
          }
        }

        expect(likerNames.size).toBeGreaterThanOrEqual(3);
      });

      it('should find mutual friends between Alice and Frank', async () => {
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const frank = allPeople.find(n => n.properties.name === 'Frank')!;

        const aliceFriendEdges = await graph.getEdgesFrom(alice.id, { filter: { types: ['FRIENDS_WITH'] } });
        const aliceFriends = await Promise.all(aliceFriendEdges.map(e => graph.getNode(e.targetId)));
        const aliceFriendList = aliceFriends.filter((n): n is Node => n !== undefined);

        const frankFriendEdges = await graph.getEdgesFrom(frank.id, { filter: { types: ['FRIENDS_WITH'] } });
        const frankFriends = await Promise.all(frankFriendEdges.map(e => graph.getNode(e.targetId)));
        const frankFriendList = frankFriends.filter((n): n is Node => n !== undefined);

        const aliceFriendIds = new Set(aliceFriendList.map(n => n.id));
        const mutualFriends = frankFriendList.filter(n => aliceFriendIds.has(n.id));
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

        const aliceFriendEdges = await reconstructed.getEdgesFrom(aliceNode!.id, { filter: { types: ['FRIENDS_WITH'] } });
        const aliceFriends = await Promise.all(aliceFriendEdges.map(e => reconstructed.getNode(e.targetId)));
        const aliceFriendList = aliceFriends.filter((n): n is Node => n !== undefined);
        expect(aliceFriendList.length).toBe(4);
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

        const friendshipEdges = await reconstructed.getEdges({ filter: { types: ['FRIENDS_WITH'] } });
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
        const results = await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'Grace' }] } });
        expect(results).toHaveLength(1);
        expect(results[0].properties.city).toBe('Denver');
      });

      it('should find nodes by type with multiple results', async () => {
        const allPersons = await graph.getNodes({ filter: { types: ['Person'] } });
        expect(allPersons.length).toBe(10);
      });

      it('should return empty for getNodesByProperty with no matches', async () => {
        const results = await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'NonExistent' }] } });
        expect(results).toHaveLength(0);
      });

      it('should filter edges by type correctly', async () => {
        const allEdges = await graph.getEdges();
        const friendships = await graph.getEdges({ filter: { types: ['FRIENDS_WITH'] } });
        const likesPost = await graph.getEdges({ filter: { types: ['LIKES_POST'] } });

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
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
        const alice = allPeople.find(n => n.properties.name === 'Alice')!;
        const bob = allPeople.find(n => n.properties.name === 'Bob')!;

        const paths = await graph.traverse(alice.id, bob.id, { method: 'bfs' });
        expect(paths).not.toBeNull();
        expect(paths!.length).toBeGreaterThan(0);
      });

      it('should handle edge type filtering in traversal', async () => {
        const allPeople = await graph.getNodes({ filter: { types: ['Person'] } });
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

        const friendshipEdges = await graph.getEdges({ filter: { types: ['FRIENDS_WITH'] } });
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
