import { afterAll, beforeAll, beforeEach, describe } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Graph } from '../src/index';
import { MongoStorageProvider } from '../src/storage/MongoStorageProvider';
import { runSocialGraphScenarios } from './shared/socialGraphScenarios';

let mongoServer: MongoMemoryServer;
let client: MongoClient;
let provider: MongoStorageProvider;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  client = new MongoClient(mongoServer.getUri());
  await client.connect();
  provider = new MongoStorageProvider(client.db('test'), { graphId: 'default' });
  await provider.ensureIndexes();
});

beforeEach(async () => {
  await provider.clear();
});

afterAll(async () => {
  await client.close();
  await mongoServer.stop();
});

describe('Facebook Social Graph (MongoDB)', () => {
  runSocialGraphScenarios(async () => {
    const graph = new Graph(provider);
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

    return graph;
  });
});
