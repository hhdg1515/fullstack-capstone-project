import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import './DetailsPage.css';
import { apiRequest } from '../../api/client';
import { giftResponse } from '../../api/gifts';

function DetailsPage() {
    const navigate = useNavigate();
    const { productId } = useParams();
    const [gift, setGift] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        setLoading(true); setError(null); setGift(null);
        apiRequest('/api/gifts/' + encodeURIComponent(productId), { validate: giftResponse }).then(data => {
            if (active) setGift(data);
        }).catch(failure => { if (active) setError(failure.message); })
            .finally(() => { if (active) setLoading(false); });
        window.scrollTo(0, 0);
        return () => { active = false; };
    }, [productId, attempt]);

    const handleBackClick = () => {
        navigate(-1);
    };

    // The comments are hardcoded for this project.
    const comments = [
        { author: "John Doe", comment: "I would like this!" },
        { author: "Jane Smith", comment: "Just DMed you." },
        { author: "Alice Johnson", comment: "I will take it if it's still available." },
        { author: "Mike Brown", comment: "This is a good one!" },
        { author: "Sarah Wilson", comment: "My family can use one. DM me if it is still available. Thank you!" }
    ];

    if (loading) return <p role="status">Loading gift…</p>;
    if (error) return <main className="container mt-5"><h1>Gift details unavailable</h1>
        <p role="alert">{error}</p><button className="btn btn-outline-secondary" onClick={() => setAttempt(value => value + 1)}>Retry gift</button>
        <p><Link to="/app">Back to gift collection</Link></p></main>;
    if (!gift) return <div>Gift not found</div>;

    return (
        <div className="container mt-5">
            <button className="btn btn-secondary mb-3" onClick={handleBackClick}>Back</button>
            <div className="card product-details-card">
                <div className="card-header text-white">
                    <h2 className="details-title">{gift.name}</h2>
                </div>
                <div className="card-body">
                    <div className="image-placeholder-large">
                        {gift.image ? (
                            <img src={gift.image} alt={gift.name} className="product-image-large" />
                        ) : (
                            <div className="no-image-available-large">No Image Available</div>
                        )}
                    </div>
                    <p><strong>Category:</strong> {gift.category}</p>
                    <p><strong>Condition:</strong> {gift.condition}</p>
                    <p><strong>Date Added:</strong> {gift.dateAdded ?? (gift.date_added ? new Date(gift.date_added * 1000).toLocaleDateString() : '')}</p>
                    <p><strong>Age (Years):</strong> {gift.age ?? gift.age_years}</p>
                    <p><strong>Description:</strong> {gift.description}</p>
                </div>
            </div>
            <div className="comments-section mt-4">
                <h3 className="mb-3">Comments</h3>
                {comments.map((comment, index) => (
                    <div key={index} className="card mb-3">
                        <div className="card-body">
                            <p className="comment-author"><strong>{comment.author}:</strong></p>
                            <p className="comment-text">{comment.comment}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default DetailsPage;
