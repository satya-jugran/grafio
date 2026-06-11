import { Dataset } from './types';

export const socialNetworkDataset: Dataset = {
  id: 'social-network',
  name: 'Social Network',
  description: 'A comprehensive social network graph with people, posts, photos, comments, and interactions.',
  data: {
      "nodes": [
            {
                  "id": "p1",
                  "labels": [
                        "Person"
                  ],
                  "properties": {
                        "name": "Alice",
                        "age": 28,
                        "city": "NYC",
                        "occupation": "Engineer"
                  }
            },
            {
                  "id": "p2",
                  "labels": [
                        "Person"
                  ],
                  "properties": {
                        "name": "Bob",
                        "age": 25,
                        "city": "LA",
                        "occupation": "Designer"
                  }
            },
            {
                  "id": "p3",
                  "labels": [
                        "Person"
                  ],
                  "properties": {
                        "name": "Charlie",
                        "age": 32,
                        "city": "Chicago",
                        "occupation": "Manager"
                  }
            },
            {
                  "id": "p4",
                  "labels": [
                        "Person"
                  ],
                  "properties": {
                        "name": "David",
                        "age": 29,
                        "city": "Seattle",
                        "occupation": "Developer"
                  }
            },
            {
                  "id": "p5",
                  "labels": [
                        "Person"
                  ],
                  "properties": {
                        "name": "Eve",
                        "age": 27,
                        "city": "Boston",
                        "occupation": "Data Scientist"
                  }
            },
            {
                  "id": "post1",
                  "labels": [
                        "Post"
                  ],
                  "properties": {
                        "content": "Just joined the social network!",
                        "timestamp": "2024-01-01",
                        "type": "status"
                  }
            },
            {
                  "id": "post2",
                  "labels": [
                        "Post"
                  ],
                  "properties": {
                        "content": "Interesting article about graphs",
                        "timestamp": "2024-02-15",
                        "type": "link"
                  }
            },
            {
                  "id": "photo1",
                  "labels": [
                        "Photo"
                  ],
                  "properties": {
                        "caption": "Amazing day at the beach!",
                        "date": "2024-06-15",
                        "location": "Hawaii"
                  }
            },
            {
                  "id": "photo2",
                  "labels": [
                        "Photo"
                  ],
                  "properties": {
                        "caption": "Friday night vibes",
                        "date": "2024-07-20",
                        "location": "LA"
                  }
            },
            {
                  "id": "c1",
                  "labels": [
                        "Comment"
                  ],
                  "properties": {
                        "content": "Welcome to the network!",
                        "date": "2024-01-01"
                  }
            },
            {
                  "id": "c2",
                  "labels": [
                        "Comment"
                  ],
                  "properties": {
                        "content": "Great read, thanks for sharing!",
                        "date": "2024-02-16"
                  }
            }
      ],
      "edges": [
            {
                  "id": "e1",
                  "sourceId": "p1",
                  "targetId": "p2",
                  "type": "FRIENDS_WITH",
                  "properties": {
                        "since": 2020,
                        "context": "college"
                  }
            },
            {
                  "id": "e2",
                  "sourceId": "p2",
                  "targetId": "p1",
                  "type": "FRIENDS_WITH",
                  "properties": {
                        "since": 2020,
                        "context": "college"
                  }
            },
            {
                  "id": "e3",
                  "sourceId": "p1",
                  "targetId": "p3",
                  "type": "FRIENDS_WITH",
                  "properties": {
                        "since": 2019,
                        "context": "work"
                  }
            },
            {
                  "id": "e4",
                  "sourceId": "p3",
                  "targetId": "p1",
                  "type": "FRIENDS_WITH",
                  "properties": {
                        "since": 2019,
                        "context": "work"
                  }
            },
            {
                  "id": "e5",
                  "sourceId": "p2",
                  "targetId": "p4",
                  "type": "FRIENDS_WITH",
                  "properties": {
                        "since": 2019,
                        "context": "coding"
                  }
            },
            {
                  "id": "e6",
                  "sourceId": "p1",
                  "targetId": "post1",
                  "type": "POSTED",
                  "properties": {
                        "timestamp": "2024-01-01T10:00:00Z"
                  }
            },
            {
                  "id": "e7",
                  "sourceId": "p2",
                  "targetId": "post2",
                  "type": "POSTED",
                  "properties": {
                        "timestamp": "2024-02-15T14:30:00Z"
                  }
            },
            {
                  "id": "e8",
                  "sourceId": "p1",
                  "targetId": "photo1",
                  "type": "PHOTO_UPLOADED",
                  "properties": {
                        "timestamp": "2024-06-15T18:00:00Z"
                  }
            },
            {
                  "id": "e9",
                  "sourceId": "p2",
                  "targetId": "post1",
                  "type": "LIKES_POST",
                  "properties": {
                        "timestamp": "2024-01-02T09:00:00Z"
                  }
            },
            {
                  "id": "e10",
                  "sourceId": "p3",
                  "targetId": "post1",
                  "type": "LIKES_POST",
                  "properties": {
                        "timestamp": "2024-01-02T10:30:00Z"
                  }
            },
            {
                  "id": "e11",
                  "sourceId": "p4",
                  "targetId": "photo1",
                  "type": "LIKES_PHOTO",
                  "properties": {
                        "timestamp": "2024-06-16T08:00:00Z"
                  }
            },
            {
                  "id": "e12",
                  "sourceId": "p2",
                  "targetId": "c1",
                  "type": "COMMENTED_ON_POST",
                  "properties": {
                        "timestamp": "2024-01-01T11:00:00Z"
                  }
            },
            {
                  "id": "e13",
                  "sourceId": "c1",
                  "targetId": "post1",
                  "type": "ON_POST",
                  "properties": {}
            }
      ]
}
};
